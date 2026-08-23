<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\EndpointEntity;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use Psr\Log\LoggerInterface;

/**
 * FTP and SFTP: browse a remote server and move files between it and the
 * user's own Nextcloud folders.
 *
 * FTP uses PHP's own ext-ftp; SFTP uses the phpseclib copy Nextcloud already
 * ships for its external-storage backends, so the app needs nothing extra
 * installed. Transfers stream through a file handle in both directions — a
 * multi-gigabyte file never lands in PHP's memory.
 */
class TransferService {
	private const CHUNK = 262144;
	/** How long one browse or transfer request may take before it gives up. */
	private const TIMEOUT = 30;

	public function __construct(
		private EndpointService $endpoints,
		private IRootFolder $rootFolder,
		private LoggerInterface $logger,
	) {
	}

	public static function sftpClass(): ?string {
		foreach (['phpseclib3\\Net\\SFTP', 'phpseclib\\Net\\SFTP'] as $class) {
			if (class_exists($class)) {
				return $class;
			}
		}
		return null;
	}

	/**
	 * A private key in whichever object the available phpseclib expects.
	 * Version 3 loads keys through a factory; version 2 through an RSA object.
	 */
	public static function loadPrivateKey(string $pem, string $passphrase = ''): mixed {
		if (class_exists('phpseclib3\\Crypt\\PublicKeyLoader')) {
			return \phpseclib3\Crypt\PublicKeyLoader::load($pem, $passphrase !== '' ? $passphrase : false);
		}
		if (class_exists('phpseclib\\Crypt\\RSA')) {
			$key = new \phpseclib\Crypt\RSA();
			if ($passphrase !== '') {
				$key->setPassword($passphrase);
			}
			if (!$key->loadKey($pem)) {
				throw new \InvalidArgumentException('That private key could not be read. RSA keys in PEM or OpenSSH format are supported.');
			}
			return $key;
		}
		throw new \RuntimeException('No SSH library is available on this server');
	}

	public function ftpAvailable(): bool {
		return function_exists('ftp_connect');
	}

	/** What this server can actually do, for the UI to explain itself. */
	public function capabilities(): array {
		return [
			'ftp' => $this->ftpAvailable(),
			'sftp' => self::sftpClass() !== null,
			'sftpLibrary' => self::sftpClass(),
		];
	}

	// ------------------------------------------------------------------ connect

	/** @return array{kind: string, handle: mixed, banner: ?string, system: ?string} */
	private function open(EndpointEntity $endpoint): array {
		$kind = (string)$endpoint->getKind();
		$host = (string)$endpoint->getHost();
		$port = (int)$endpoint->getPort() ?: ($kind === 'sftp' ? 22 : 21);
		$user = (string)$endpoint->getUsername();
		$pass = $this->endpoints->secret($endpoint);
		$mode = (string)$this->endpoints->option($endpoint, 'mode', 'none');

		if ($kind === 'sftp') {
			$class = self::sftpClass();
			if ($class === null) {
				throw new \RuntimeException('No SFTP library is available on this server');
			}
			$sftp = new $class($host, $port, self::TIMEOUT);
			$credentials = $this->endpoints->credentials($endpoint);
			$secret = $credentials['key'] !== ''
				? self::loadPrivateKey($credentials['key'], $credentials['passphrase'])
				: $credentials['password'];
			if (!@$sftp->login($user, $secret)) {
				throw new \RuntimeException('SFTP sign-in was refused for ' . $user . '@' . $host);
			}
			return ['kind' => 'sftp', 'handle' => $sftp, 'banner' => (string)$sftp->getServerIdentification(), 'system' => null];
		}

		if ($kind !== 'ftp') {
			throw new \InvalidArgumentException('This connection is not a file transfer connection');
		}
		if (!$this->ftpAvailable()) {
			throw new \RuntimeException('The PHP ftp extension is not installed on this server');
		}
		$conn = $mode === 'tls' ? @ftp_ssl_connect($host, $port, self::TIMEOUT) : @ftp_connect($host, $port, self::TIMEOUT);
		if ($conn === false) {
			throw new \RuntimeException('Could not connect to ' . $host . ':' . $port);
		}
		$loginUser = $user !== '' ? $user : 'anonymous';
		$loginPass = $user !== '' ? $pass : 'anonymous@';
		if (!@ftp_login($conn, $loginUser, $loginPass)) {
			@ftp_close($conn);
			throw new \RuntimeException('FTP sign-in was refused for ' . $loginUser . '@' . $host);
		}
		if ((bool)$this->endpoints->option($endpoint, 'passive', true)) {
			@ftp_pasv($conn, true);
		}
		$system = @ftp_systype($conn);
		return ['kind' => 'ftp', 'handle' => $conn, 'banner' => null, 'system' => $system === false ? null : $system];
	}

	private function close(array $session): void {
		if ($session['kind'] === 'ftp' && $session['handle'] !== null) {
			@ftp_close($session['handle']);
		} elseif ($session['kind'] === 'sftp' && method_exists($session['handle'], 'disconnect')) {
			@$session['handle']->disconnect();
		}
	}

	/** Connect, look around, disconnect — the "does this work?" button. */
	public function test(EndpointEntity $endpoint): array {
		$started = microtime(true);
		try {
			$session = $this->open($endpoint);
			$home = $session['kind'] === 'ftp' ? (@ftp_pwd($session['handle']) ?: '/') : ((string)$session['handle']->pwd() ?: '/');
			$entries = $this->readDir($session, $home);
			$this->close($session);
			$this->endpoints->touch($endpoint, 'Connected');
			return [
				'ok' => true, 'kind' => $session['kind'], 'home' => $home,
				'banner' => $session['banner'], 'system' => $session['system'],
				'entries' => count($entries), 'seconds' => round(microtime(true) - $started, 3),
			];
		} catch (\Throwable $e) {
			$this->endpoints->touch($endpoint, 'Failed: ' . $e->getMessage());
			return ['ok' => false, 'error' => $e->getMessage(), 'seconds' => round(microtime(true) - $started, 3)];
		}
	}

	// ------------------------------------------------------------------ browsing

	/** @return array<string, mixed> */
	public function listDirectory(EndpointEntity $endpoint, string $path = ''): array {
		$session = $this->open($endpoint);
		try {
			$path = $this->cleanPath($path !== '' ? $path : (string)$this->endpoints->option($endpoint, 'path', ''));
			if ($path === '') {
				$path = $session['kind'] === 'ftp' ? (@ftp_pwd($session['handle']) ?: '/') : ((string)$session['handle']->pwd() ?: '/');
			}
			$entries = $this->readDir($session, $path);
			usort($entries, static function (array $a, array $b) {
				if ($a['directory'] !== $b['directory']) {
					return $a['directory'] ? -1 : 1;
				}
				return strnatcasecmp($a['name'], $b['name']);
			});
			$this->endpoints->touch($endpoint, 'Listed ' . $path);
			return ['path' => $path, 'parent' => $this->parentOf($path), 'entries' => $entries, 'kind' => $session['kind']];
		} finally {
			$this->close($session);
		}
	}

	/** @return array<int, array<string, mixed>> */
	private function readDir(array $session, string $path): array {
		$entries = [];
		if ($session['kind'] === 'sftp') {
			$list = @$session['handle']->rawlist($path === '' ? '.' : $path);
			if ($list === false) {
				throw new \RuntimeException('Could not read ' . $path);
			}
			foreach ($list as $name => $item) {
				if ($name === '.' || $name === '..') {
					continue;
				}
				$isDir = (int)($item['type'] ?? 0) === 2;
				$entries[] = [
					'name' => (string)$name,
					'directory' => $isDir,
					'size' => $isDir ? null : (int)($item['size'] ?? 0),
					'modified' => isset($item['mtime']) ? (int)$item['mtime'] : null,
					'permissions' => isset($item['permissions']) ? substr(sprintf('%o', (int)$item['permissions']), -4) : null,
					'owner' => isset($item['uid']) ? (string)$item['uid'] : null,
				];
			}
			return $entries;
		}

		$raw = @ftp_mlsd($session['handle'], $path);
		if (is_array($raw) && $raw !== []) {
			foreach ($raw as $item) {
				$name = (string)($item['name'] ?? '');
				if ($name === '' || $name === '.' || $name === '..') {
					continue;
				}
				$type = strtolower((string)($item['type'] ?? ''));
				$modified = null;
				if (isset($item['modify']) && preg_match('/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/', (string)$item['modify'], $m)) {
					$modified = (int)gmmktime((int)$m[4], (int)$m[5], (int)$m[6], (int)$m[2], (int)$m[3], (int)$m[1]);
				}
				$entries[] = [
					'name' => $name,
					'directory' => $type === 'dir' || $type === 'cdir' || $type === 'pdir',
					'size' => isset($item['size']) ? (int)$item['size'] : null,
					'modified' => $modified,
					'permissions' => isset($item['unix.mode']) ? (string)$item['unix.mode'] : null,
					'owner' => isset($item['unix.owner']) ? (string)$item['unix.owner'] : null,
				];
			}
			return $entries;
		}

		// Servers without MLSD still answer LIST, whose format is a Unix `ls`
		// dialect most of the time.
		$lines = @ftp_rawlist($session['handle'], $path === '' ? '.' : $path);
		if ($lines === false) {
			throw new \RuntimeException('Could not read ' . $path);
		}
		foreach ($lines as $line) {
			if (preg_match('/^([\-dlbcps])([rwxSsTt\-]{9})\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+\s+\S+\s+\S+)\s+(.+)$/', $line, $m)) {
				$name = $m[7];
				if ($name === '.' || $name === '..') {
					continue;
				}
				$entries[] = [
					'name' => $name,
					'directory' => $m[1] === 'd',
					'size' => $m[1] === 'd' ? null : (int)$m[5],
					'modified' => null,
					'permissions' => $m[2],
					'owner' => $m[3],
					'link' => $m[1] === 'l',
				];
			} elseif (trim($line) !== '' && !preg_match('/^total\s/i', $line)) {
				$entries[] = ['name' => trim($line), 'directory' => false, 'size' => null, 'modified' => null, 'permissions' => null, 'owner' => null, 'raw' => true];
			}
		}
		return $entries;
	}

	// ------------------------------------------------------------------ transfer

	/**
	 * Remote file → the user's Nextcloud files.
	 *
	 * @return array<string, mixed>
	 */
	public function download(EndpointEntity $endpoint, string $userId, string $remotePath, string $targetFolder): array {
		$remotePath = $this->cleanPath($remotePath);
		if ($remotePath === '' || str_ends_with($remotePath, '/')) {
			throw new \InvalidArgumentException('Choose a file to download');
		}
		$name = basename($remotePath);
		$folder = $this->userFolder($userId, $targetFolder);
		$target = $this->uniqueName($folder, $name);

		$session = $this->open($endpoint);
		$started = microtime(true);
		try {
			$file = $folder->newFile($target);
			$written = 0;
			$handle = $file->fopen('w');
			if (!is_resource($handle)) {
				throw new \RuntimeException('Could not open the destination file in Nextcloud');
			}
			try {
				if ($session['kind'] === 'ftp') {
					if (!@ftp_fget($session['handle'], $handle, $remotePath, FTP_BINARY)) {
						throw new \RuntimeException('The server refused to send ' . $remotePath);
					}
				} else {
					$sftp = $session['handle'];
					// phpseclib 3 renamed size() to filesize().
					$size = method_exists($sftp, 'filesize') ? @$sftp->filesize($remotePath) : @$sftp->size($remotePath);
					if ($size === false) {
						throw new \RuntimeException('No such file: ' . $remotePath);
					}
					// Chunked, because phpseclib 2 returns the whole file as a
					// string when no local file is given.
					for ($offset = 0; $offset < $size; $offset += self::CHUNK) {
						$chunk = @$sftp->get($remotePath, false, $offset, min(self::CHUNK, $size - $offset));
						if ($chunk === false) {
							throw new \RuntimeException('The transfer stopped at ' . $offset . ' bytes');
						}
						fwrite($handle, $chunk);
					}
				}
				$written = (int)ftell($handle);
			} finally {
				fclose($handle);
			}
			$this->endpoints->touch($endpoint, 'Downloaded ' . $name);
			return [
				'ok' => true, 'name' => $target, 'path' => $folder->getInternalPath() . '/' . $target,
				'bytes' => $written, 'seconds' => round(microtime(true) - $started, 3),
			];
		} catch (\Throwable $e) {
			try {
				$folder->get($target)->delete();
			} catch (\Throwable) {
				// nothing to clean up
			}
			throw $e;
		} finally {
			$this->close($session);
		}
	}

	/**
	 * A file from the user's Nextcloud files → the remote server.
	 *
	 * @return array<string, mixed>
	 */
	public function upload(EndpointEntity $endpoint, string $userId, string $sourcePath, string $remoteDir): array {
		$userFolder = $this->rootFolder->getUserFolder($userId);
		try {
			$node = $userFolder->get(ltrim($sourcePath, '/'));
		} catch (NotFoundException) {
			throw new \InvalidArgumentException('No such file in your Nextcloud files: ' . $sourcePath);
		}
		if (!$node instanceof File) {
			throw new \InvalidArgumentException('Only files can be uploaded, not folders');
		}
		$remoteDir = rtrim($this->cleanPath($remoteDir), '/');
		$remotePath = ($remoteDir === '' ? '' : $remoteDir) . '/' . $node->getName();

		$session = $this->open($endpoint);
		$started = microtime(true);
		$sent = 0;
		try {
			$handle = $node->fopen('r');
			if (!is_resource($handle)) {
				throw new \RuntimeException('Could not read the source file');
			}
			try {
				if ($session['kind'] === 'ftp') {
					if (!@ftp_fput($session['handle'], $remotePath, $handle, FTP_BINARY)) {
						throw new \RuntimeException('The server refused the upload');
					}
				} else {
					$class = self::sftpClass();
					$callback = constant($class . '::SOURCE_CALLBACK');
					// phpseclib ends the transfer when the callback returns null;
					// an empty string would keep it writing for ever.
					$reader = static function (int $length) use ($handle): ?string {
						$data = fread($handle, $length);
						return ($data === false || $data === '') ? null : $data;
					};
					if (!@$session['handle']->put($remotePath, $reader, $callback)) {
						throw new \RuntimeException('The server refused the upload');
					}
				}
				// What we actually read, rather than the node's cached size, which
				// may not be written back yet.
				$sent = (int)ftell($handle);
			} finally {
				fclose($handle);
			}
			$this->endpoints->touch($endpoint, 'Uploaded ' . $node->getName());
			return ['ok' => true, 'remote' => $remotePath, 'bytes' => $sent, 'seconds' => round(microtime(true) - $started, 3)];
		} finally {
			$this->close($session);
		}
	}

	// ------------------------------------------------------------------ housekeeping

	public function manage(EndpointEntity $endpoint, string $action, string $path, string $extra = ''): array {
		$path = $this->cleanPath($path);
		if ($path === '' || $path === '/') {
			throw new \InvalidArgumentException('Refusing to act on the root directory');
		}
		$session = $this->open($endpoint);
		try {
			$ftp = $session['kind'] === 'ftp';
			$handle = $session['handle'];
			$ok = match ($action) {
				'mkdir' => $ftp ? @ftp_mkdir($handle, $path) !== false : @$handle->mkdir($path),
				'rmdir' => $ftp ? @ftp_rmdir($handle, $path) : @$handle->rmdir($path),
				'delete' => $ftp ? @ftp_delete($handle, $path) : @$handle->delete($path, false),
				'rename' => $ftp ? @ftp_rename($handle, $path, $this->cleanPath($extra)) : @$handle->rename($path, $this->cleanPath($extra)),
				'chmod' => $ftp ? @ftp_chmod($handle, (int)octdec($extra ?: '644'), $path) !== false : @$handle->chmod((int)octdec($extra ?: '644'), $path),
				default => throw new \InvalidArgumentException('Unknown action'),
			};
			if (!$ok) {
				throw new \RuntimeException('The server refused: ' . $action . ' ' . $path);
			}
			$this->endpoints->touch($endpoint, $action . ' ' . $path);
			return ['ok' => true, 'action' => $action, 'path' => $path];
		} finally {
			$this->close($session);
		}
	}

	/**
	 * One folder of the user's own Nextcloud files, for the picker.
	 *
	 * Typing a path from memory is the kind of small friction that makes a
	 * feature feel unfinished, so anywhere NetBase needs a file it can offer
	 * this instead.
	 *
	 * @return array<string, mixed>
	 */
	public function browseNextcloud(string $userId, string $path = '', bool $foldersOnly = false): array {
		$userFolder = $this->rootFolder->getUserFolder($userId);
		$path = trim($path, '/');
		$node = $path === '' ? $userFolder : null;
		if ($node === null) {
			try {
				$node = $userFolder->get($path);
			} catch (NotFoundException) {
				throw new \InvalidArgumentException('No such folder in your Nextcloud files: ' . $path);
			}
		}
		if (!$node instanceof Folder) {
			throw new \InvalidArgumentException('That is a file, not a folder');
		}

		$entries = [];
		foreach ($node->getDirectoryListing() as $child) {
			$isFolder = $child instanceof Folder;
			if ($foldersOnly && !$isFolder) {
				continue;
			}
			$entries[] = [
				'name' => $child->getName(),
				'path' => trim($path . '/' . $child->getName(), '/'),
				'directory' => $isFolder,
				'size' => $isFolder ? null : $child->getSize(),
				'modified' => $child->getMTime(),
			];
		}
		usort($entries, static function (array $a, array $b) {
			if ($a['directory'] !== $b['directory']) {
				return $a['directory'] ? -1 : 1;
			}
			return strnatcasecmp($a['name'], $b['name']);
		});

		return [
			'path' => $path,
			'parent' => $path === '' ? null : trim(dirname($path), '.'),
			'entries' => $entries,
		];
	}

	// ------------------------------------------------------------------ helpers

	private function userFolder(string $userId, string $path): Folder {
		$userFolder = $this->rootFolder->getUserFolder($userId);
		$path = trim($path, '/');
		if ($path === '') {
			return $userFolder;
		}
		try {
			$node = $userFolder->get($path);
			if ($node instanceof Folder) {
				return $node;
			}
			throw new \InvalidArgumentException('The destination is a file, not a folder');
		} catch (NotFoundException) {
			return $userFolder->newFolder($path);
		}
	}

	/** Never overwrite: "report.csv" becomes "report (2).csv". */
	private function uniqueName(Folder $folder, string $name): string {
		$name = str_replace(['/', "\0"], '_', $name) ?: 'download';
		if (!$folder->nodeExists($name)) {
			return $name;
		}
		$extension = pathinfo($name, PATHINFO_EXTENSION);
		$base = $extension !== '' ? substr($name, 0, -strlen($extension) - 1) : $name;
		for ($i = 2; $i < 500; $i++) {
			$candidate = $base . ' (' . $i . ')' . ($extension !== '' ? '.' . $extension : '');
			if (!$folder->nodeExists($candidate)) {
				return $candidate;
			}
		}
		return $base . '-' . bin2hex(random_bytes(4)) . ($extension !== '' ? '.' . $extension : '');
	}

	/** No NUL bytes, no "..", no surprises. */
	private function cleanPath(string $path): string {
		$path = str_replace(["\0", "\r", "\n"], '', trim($path));
		$parts = [];
		foreach (explode('/', $path) as $part) {
			if ($part === '' || $part === '.') {
				continue;
			}
			if ($part === '..') {
				array_pop($parts);
				continue;
			}
			$parts[] = $part;
		}
		$absolute = str_starts_with($path, '/');
		return ($absolute ? '/' : '') . implode('/', $parts);
	}

	private function parentOf(string $path): ?string {
		$path = rtrim($path, '/');
		if ($path === '' || $path === '/') {
			return null;
		}
		$parent = dirname($path);
		return $parent === '.' ? '/' : $parent;
	}
}
