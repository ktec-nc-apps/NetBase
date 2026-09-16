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
 * FTP uses PHP's own ext-ftp; SFTP and SCP use the phpseclib 3 copy NetBase
 * carries with it, so the app needs nothing extra
 * installed. Transfers stream through a file handle in both directions — a
 * multi-gigabyte file never lands in PHP's memory.
 */
class TransferService {
	/**
	 * What a folder download will not exceed: how deep, how many files, how
	 * many bytes. A folder is whatever somebody made it, and this runs inside
	 * one web request on a shared server.
	 */
	private const ZIP_DEPTH = 12;
	private const ZIP_FILES = 2000;
	private const ZIP_BYTES = 536870912;

	private const CHUNK = 262144;
	/** How long one browse or transfer request may take before it gives up. */
	private const TIMEOUT = 30;

	/**
	 * How long a stray temporary copy may sit in the system's temporary folder
	 * before it is swept away.
	 *
	 * No transfer holds one for anything like this long. The margin is there so
	 * that a slow transfer running in another request at this same moment is
	 * never pulled out from under it.
	 */
	private const STALE_TEMP = 21600;

	/**
	 * How much of a file may be opened for reading in a window.
	 *
	 * The whole of it is held in memory twice over — once as it came off the
	 * wire, once converted — so this is a real limit rather than a cautious
	 * one. Anything larger is downloaded instead, which streams.
	 */
	private const TEXT_BYTES = 1048576;

	/**
	 * What a text file is likely to be written in, most likely first.
	 *
	 * A server in Japan still holds files in Shift_JIS and EUC-JP far more
	 * often than anywhere else, and showing those as mojibake would make the
	 * viewer useless exactly where it is most needed. Whatever is found is
	 * remembered, so saving writes the file back the way it was.
	 */
	private const TEXT_ENCODINGS = ['UTF-8', 'SJIS-win', 'EUC-JP', 'ISO-2022-JP', 'Windows-1252'];

	public function __construct(
		private EndpointService $endpoints,
		private IRootFolder $rootFolder,
		private L10nService $l,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * The SCP class, when one is about. A server can offer SSH without the SFTP
	 * subsystem, and on that machine SCP is the only way to move a file.
	 */
	public static function scpClass(): ?string {
		foreach (['OCA\\NetBase\\Vendor\\phpseclib3\\Net\\SCP', 'phpseclib3\\Net\\SCP', 'phpseclib\\Net\\SCP'] as $class) {
			if (class_exists($class)) {
				return $class;
			}
		}
		return null;
	}

	public static function sftpClass(): ?string {
		foreach (['OCA\\NetBase\\Vendor\\phpseclib3\\Net\\SFTP', 'phpseclib3\\Net\\SFTP', 'phpseclib\\Net\\SFTP'] as $class) {
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
		foreach (['OCA\\NetBase\\Vendor\\phpseclib3\\Crypt\\PublicKeyLoader', 'phpseclib3\\Crypt\\PublicKeyLoader'] as $loader) {
			if (class_exists($loader)) {
				return $loader::load($pem, $passphrase !== '' ? $passphrase : false);
			}
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
			'scp' => self::scpClass() !== null,
			// Running as root is an SCP-only affair: it works by putting the
			// command through sudo, and only SCP reaches a server that way.
			'elevate' => self::scpClass() !== null,
		];
	}

	// ------------------------------------------------------------------ connect

	/** @return array{kind: string, handle: mixed, banner: ?string, system: ?string} */
	/**
	 * @param string $sudoPassword given for this one request and held nowhere:
	 *                              not in the settings, not in RegiBase, not on
	 *                              disk. Only SCP can use it, and only for the
	 *                              commands it runs — never for a file's contents,
	 *                              which travel over the command's own input.
	 */
	/**
	 * @param string $prefer the protocol the screen is set to. A saved SSH
	 *                       connection can be opened three ways, and which one
	 *                       is wanted is the reader's choice, not a guess: SCP
	 *                       was offered SSH connections and then opened them
	 *                       over SFTP, which cannot elevate, so "act as root"
	 *                       silently did nothing.
	 */
	private function open(EndpointEntity $endpoint, string $sudoPassword = '', string $prefer = ''): array {
		$this->sweepTemps();
		$kind = (string)$endpoint->getKind();
		if ($prefer === 'scp' && $kind === 'ssh') {
			$kind = 'scp';
		}
		$host = (string)$endpoint->getHost();
		$port = (int)$endpoint->getPort() ?: (in_array($kind, ['sftp', 'scp', 'ssh'], true) ? 22 : 21);
		$user = (string)$endpoint->getUsername();
		$pass = $this->endpoints->secret($endpoint);
		$mode = (string)$this->endpoints->option($endpoint, 'mode', 'none');

		// A saved SSH connection is the same machine, the same account and the
		// same key as an SFTP one — the only difference is which subsystem is
		// asked for once the sign-in is done. Somebody with sixteen servers
		// saved should not have to type all sixteen again to look at a file, so
		// an 'ssh' connection opens over SFTP here, and falls back to SCP for a
		// server that offers a shell but no SFTP subsystem.
		if ($kind === 'sftp' || $kind === 'ssh') {
			$class = self::sftpClass();
			if ($class === null && $kind === 'ssh') {
				return $this->openScp($endpoint, $host, $port, $user, $sudoPassword);
			}
			if ($class === null) {
				throw new \RuntimeException('No SFTP library is available on this server');
			}
			$sftp = new $class($host, $port, self::TIMEOUT);
			$credentials = $this->endpoints->credentials($endpoint);
			$secret = $credentials['key'] !== ''
				? self::loadPrivateKey($credentials['key'], $credentials['passphrase'])
				: $credentials['password'];
			if (!@$sftp->login($user, $secret)) {
				// The sign-in may have been refused, or accepted by a server
				// with no SFTP subsystem. SCP tells the two apart: it needs the
				// same credentials but only a shell.
				if ($kind === 'ssh' && self::scpClass() !== null) {
					try {
						return $this->openScp($endpoint, $host, $port, $user, $sudoPassword);
					} catch (\Throwable $e) {
						// Fall through and report the SFTP refusal, which is
						// the one the reader will understand.
					}
				}
				throw new \RuntimeException($this->l->t('SFTP sign-in was refused for %1$s@%2$s', [$user, $host]));
			}
			return ['kind' => 'sftp', 'handle' => $sftp, 'banner' => (string)$sftp->getServerIdentification(), 'system' => null];
		}

		if ($kind === 'scp') {
			return $this->openScp($endpoint, $host, $port, $user, $sudoPassword);
		}

		if ($kind !== 'ftp') {
			throw new \InvalidArgumentException('This connection is not a file transfer connection');
		}
		if (!$this->ftpAvailable()) {
			throw new \RuntimeException('The PHP ftp extension is not installed on this server');
		}
		$conn = $mode === 'tls' ? @ftp_ssl_connect($host, $port, self::TIMEOUT) : @ftp_connect($host, $port, self::TIMEOUT);
		if ($conn === false) {
			throw new \RuntimeException($this->l->t('Could not connect to %1$s:%2$s', [$host, (string)$port]));
		}
		$loginUser = $user !== '' ? $user : 'anonymous';
		$loginPass = $user !== '' ? $pass : 'anonymous@';
		if (!@ftp_login($conn, $loginUser, $loginPass)) {
			@ftp_close($conn);
			throw new \RuntimeException($this->l->t('FTP sign-in was refused for %1$s@%2$s', [$loginUser, $host]));
		}
		if ((bool)$this->endpoints->option($endpoint, 'passive', true)) {
			@ftp_pasv($conn, true);
		}
		$system = @ftp_systype($conn);
		return ['kind' => 'ftp', 'handle' => $conn, 'banner' => null, 'system' => $system === false ? null : $system];
	}

	/**
	 * SCP, over the same sign-in SFTP would have used.
	 *
	 * @return array{kind: string, handle: mixed, banner: ?string, system: ?string}
	 */
	private function openScp(EndpointEntity $endpoint, string $host, int $port, string $user, string $sudoPassword = ''): array {
		$class = self::scpClass();
		if ($class === null) {
			throw new \RuntimeException('No SCP library is available on this server');
		}
		$scp = new $class($host, $port, self::TIMEOUT);
		$credentials = $this->endpoints->credentials($endpoint);
		$secret = $credentials['key'] !== ''
			? self::loadPrivateKey($credentials['key'], $credentials['passphrase'])
			: $credentials['password'];
		if (!@$scp->login($user, $secret)) {
			throw new \RuntimeException($this->l->t('SCP sign-in was refused for %1$s@%2$s', [$user, $host]));
		}
		$session = new ScpSession($scp, $sudoPassword);
		return ['kind' => 'scp', 'handle' => $session, 'banner' => $session->getServerIdentification(), 'system' => null];
	}

	/**
	 * Clear away the temporary copies a request that died left behind.
	 *
	 * SCP has no notion of an offset, so it stages whatever it fetches on this
	 * server's own disk; a folder download builds its ZIP there too. Both are
	 * removed the moment they are finished with — but a request that dies
	 * before reaching that line (a fatal error, a timeout, a worker killed
	 * mid-transfer) never reaches it, and nothing else would ever remove them.
	 * Left alone they accumulate silently, which is how six of them came to be
	 * sitting in /tmp after this morning's ZIP fault.
	 *
	 * The sweep runs on the way into a connection, which is the one place that
	 * every transfer — FTP, SFTP, SCP — passes through.
	 */
	private function sweepTemps(): void {
		$old = time() - self::STALE_TEMP;
		foreach (['netbase-scp-', 'netbase-zip-'] as $prefix) {
			foreach ((array)@glob(sys_get_temp_dir() . '/' . $prefix . '*') as $file) {
				if (is_file($file) && (int)@filemtime($file) < $old) {
					@unlink($file);
				}
			}
		}
	}

	/**
	 * A file's permissions as the four digits people expect to read.
	 *
	 * What arrives is the whole st_mode — the permission bits with the file
	 * type above them, 0100640 for an ordinary file at 0640 — from either of
	 * the two names the listings use for it. Only the last four digits mean
	 * anything to the reader, and a listing that carried no mode at all (FTP
	 * servers that answer neither MLSD nor a Unix LIST) must stay empty rather
	 * than claim 0000.
	 */
	private function modeText(mixed $mode): ?string {
		if ($mode === null || $mode === '' || !is_numeric($mode)) {
			return null;
		}
		return substr(sprintf('%o', (int)$mode), -4);
	}

	private function close(array $session): void {
		if ($session['kind'] === 'ftp' && $session['handle'] !== null) {
			@ftp_close($session['handle']);
		} elseif ($session['kind'] !== 'ftp' && method_exists($session['handle'], 'disconnect')) {
			@$session['handle']->disconnect();
		}
	}

	/**
	 * Connect, look around, disconnect — the "does this work?" button.
	 *
	 * No preferred protocol here, deliberately: this answers "does the
	 * connection as it was saved work", so it opens the way the saved type
	 * says. Testing it as something else would answer a different question.
	 */
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
	public function listDirectory(EndpointEntity $endpoint, string $path = '', string $sudoPassword = '', string $prefer = ''): array {
		$session = $this->open($endpoint, $sudoPassword, $prefer);
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
		if ($session['kind'] !== 'ftp') {
			$list = @$session['handle']->rawlist($path === '' ? '.' : $path);
			if ($list === false) {
				throw new \RuntimeException($this->l->t('Could not read %s', [$path]));
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
					// Two spellings reach here, and both have to be read. phpseclib's
					// SFTP calls this 'mode'; ScpSession::rawlist(), which parses
					// `ls -la` itself, calls it 'permissions'. Looking for only one
					// of them empties the column for the other — first for every
					// SFTP and SCP connection alike, then, once 'mode' was the only
					// name read, for SCP alone. Either spelling carries the same
					// thing: the whole st_mode with the file type in it (0100640 for
					// an ordinary file at 0640), so the last four digits are what to
					// show.
					'permissions' => $this->modeText($item['mode'] ?? $item['permissions'] ?? null),
					// SFTP version 3 carries the owner as a number and nothing else:
					// the attribute that holds a name is defined in version 4, which
					// OpenSSH does not speak. A uid is all there is to show here.
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
			throw new \RuntimeException($this->l->t('Could not read %s', [$path]));
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
	/**
	 * A whole folder, brought back as one ZIP file.
	 *
	 * The archive is built here rather than on the far end. A server that can
	 * be reached over SCP usually has tar; one reached over FTP has nothing at
	 * all, and even among Unix hosts zip is often absent — this machine's own
	 * test server has tar but no zip. Building it here is the only way that
	 * works the same everywhere, and it needs nothing installed anywhere.
	 *
	 * Three limits, because a folder can be anything: how deep it walks, how
	 * many files it takes, and how many bytes in total. Reaching one stops the
	 * walk and is reported back — an archive that quietly missed half the
	 * folder would be worse than a refusal.
	 *
	 * @return array{path: string, name: string, bytes: int, files: int, seconds: float, truncated: bool}
	 */
	public function downloadFolder(EndpointEntity $endpoint, string $userId, string $remotePath, string $targetFolder, string $prefer = '', string $sudoPassword = ''): array {
		if (!class_exists(\ZipArchive::class)) {
			throw new \RuntimeException($this->l->t('This server cannot make ZIP files. The PHP zip extension is needed.'));
		}
		$remotePath = rtrim($this->cleanPath($remotePath), '/');
		if ($remotePath === '' || $remotePath === '/') {
			throw new \InvalidArgumentException('Choose a folder to download');
		}
		$folder = $this->userFolder($userId, $targetFolder);
		$name = basename($remotePath) . '.zip';
		$target = $this->uniqueName($folder, $name);

		$session = $this->open($endpoint, $sudoPassword, $prefer);
		$started = microtime(true);
		$tmp = tempnam(sys_get_temp_dir(), 'netbase-zip-');
		if ($tmp === false) {
			$this->close($session);
			throw new \RuntimeException('No temporary file could be made on this server');
		}
		$zip = new \ZipArchive();
		if ($zip->open($tmp, \ZipArchive::OVERWRITE) !== true) {
			@unlink($tmp);
			$this->close($session);
			throw new \RuntimeException('The ZIP file could not be started');
		}
		$count = 0;
		$bytes = 0;
		$truncated = false;
		$open = true;
		try {
			$this->addFolderToZip($session, $zip, $remotePath, '', 0, $count, $bytes, $truncated);
			if ($count === 0) {
				// An empty archive is a puzzle to receive. Say so instead.
				throw new \RuntimeException($this->l->t('There is nothing to download in %s', [$remotePath]));
			}
			// Closing is what actually writes the archive, so it has to happen
			// before the file is read back — and it must not happen twice: a
			// second close on a closed archive throws "Invalid or uninitialized
			// Zip object", which is what the finally below used to do.
			if (!$zip->close()) {
				throw new \RuntimeException('The ZIP file could not be finished');
			}
			$open = false;
			$file = $folder->newFile($target);
			$in = @fopen($tmp, 'rb');
			$out = $file->fopen('w');
			if (!is_resource($in) || !is_resource($out)) {
				throw new \RuntimeException('Could not write the ZIP file into your Nextcloud files');
			}
			try {
				stream_copy_to_stream($in, $out);
			} finally {
				fclose($in);
				fclose($out);
			}
			$size = (int)@filesize($tmp);
			$this->refreshSize($file);
			$this->endpoints->touch($endpoint, 'Downloaded ' . $remotePath . ' as ZIP');
			return [
				'path' => $folder->getInternalPath() . '/' . $target,
				'name' => $target,
				'bytes' => $size,
				'files' => $count,
				'seconds' => round(microtime(true) - $started, 3),
				'truncated' => $truncated,
			];
		} finally {
			if ($open) {
				@$zip->close();
			}
			@unlink($tmp);
			$this->close($session);
		}
	}

	/**
	 * One folder's worth of the archive, and then its folders in turn.
	 *
	 * @param array<string, mixed> $session
	 */
	private function addFolderToZip(array $session, \ZipArchive $zip, string $remote, string $inside, int $depth,
		int &$count, int &$bytes, bool &$truncated): void {
		if ($depth > self::ZIP_DEPTH || $truncated) {
			$truncated = $truncated || $depth > self::ZIP_DEPTH;
			return;
		}
		$zip->addEmptyDir($inside === '' ? basename($remote) : $inside);
		foreach ($this->readDir($session, $remote) as $entry) {
			$nm = (string)($entry['name'] ?? '');
			if ($nm === '' || $nm === '.' || $nm === '..') {
				continue;
			}
			$here = $inside === '' ? basename($remote) . '/' . $nm : $inside . '/' . $nm;
			$there = $remote . '/' . $nm;
			if (!empty($entry['directory'])) {
				$this->addFolderToZip($session, $zip, $there, $here, $depth + 1, $count, $bytes, $truncated);
				continue;
			}
			if ($count >= self::ZIP_FILES || $bytes >= self::ZIP_BYTES) {
				$truncated = true;
				return;
			}
			$data = $this->readWholeFile($session, $there);
			if ($data === null) {
				continue;
			}
			$zip->addFromString($here, $data);
			$count++;
			$bytes += strlen($data);
		}
	}

	/** One file's contents, whichever protocol is open, or null if it cannot be read. */
	private function readWholeFile(array $session, string $path): ?string
	{
		if ($session['kind'] === 'ftp') {
			$tmp = fopen('php://temp', 'w+b');
			if (!is_resource($tmp)) {
				return null;
			}
			$ok = @ftp_fget($session['handle'], $tmp, $path, FTP_BINARY);
			if (!$ok) {
				fclose($tmp);
				return null;
			}
			rewind($tmp);
			$out = stream_get_contents($tmp);
			fclose($tmp);
			return $out === false ? null : $out;
		}
		$handle = $session['handle'];
		$data = @$handle->get($path);
		return is_string($data) ? $data : null;
	}

	public function download(EndpointEntity $endpoint, string $userId, string $remotePath, string $targetFolder, string $prefer = ''): array {
		$remotePath = $this->cleanPath($remotePath);
		if ($remotePath === '' || str_ends_with($remotePath, '/')) {
			throw new \InvalidArgumentException('Choose a file to download');
		}
		$name = basename($remotePath);
		$folder = $this->userFolder($userId, $targetFolder);
		$target = $this->uniqueName($folder, $name);

		$session = $this->open($endpoint, '', $prefer);
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
						throw new \RuntimeException($this->l->t('The server refused to send %s', [$remotePath]));
					}
				} else {
					$sftp = $session['handle'];
					// phpseclib 3 renamed size() to filesize().
					$size = method_exists($sftp, 'filesize') ? @$sftp->filesize($remotePath) : @$sftp->size($remotePath);
					if ($size === false) {
						throw new \RuntimeException($this->l->t('No such file: %s', [$remotePath]));
					}
					// Chunked, because phpseclib 2 returns the whole file as a
					// string when no local file is given.
					for ($offset = 0; $offset < $size; $offset += self::CHUNK) {
						$chunk = @$sftp->get($remotePath, false, $offset, min(self::CHUNK, $size - $offset));
						if ($chunk === false) {
							throw new \RuntimeException($this->l->t('The transfer stopped at %d bytes', [$offset]));
						}
						fwrite($handle, $chunk);
					}
				}
				$written = (int)ftell($handle);
			} finally {
				fclose($handle);
			}
			$this->refreshSize($file);
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
	public function upload(EndpointEntity $endpoint, string $userId, string $sourcePath, string $remoteDir, string $prefer = ''): array {
		$userFolder = $this->rootFolder->getUserFolder($userId);
		try {
			$node = $userFolder->get(ltrim($sourcePath, '/'));
		} catch (NotFoundException) {
			throw new \InvalidArgumentException($this->l->t('No such file in your Nextcloud files: %s', [$sourcePath]));
		}
		if (!$node instanceof File) {
			throw new \InvalidArgumentException('Only files can be uploaded, not folders');
		}
		$remoteDir = rtrim($this->cleanPath($remoteDir), '/');
		$remotePath = ($remoteDir === '' ? '' : $remoteDir) . '/' . $node->getName();

		$session = $this->open($endpoint, '', $prefer);
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
					$callback = constant(get_class($session['handle']) . '::SOURCE_CALLBACK');
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

	// ------------------------------------------------------- transfer, reported

	/**
	 * One transfer, told about while it is still running.
	 *
	 * A file worth moving is often large enough that a silent wait looks like a
	 * hang. The bytes are counted where they actually pass — in the reader that
	 * feeds the upload, and in the loop that writes the download — so the count
	 * is the truth rather than an estimate, and it works the same over SFTP,
	 * SCP and FTP.
	 *
	 * $emit returns false when the browser has gone away; the transfer then
	 * stops rather than finishing into a page nobody is looking at.
	 *
	 * @param array{direction?: string, remote?: string, local?: string, target?: string} $job
	 * @param callable(array<string, mixed>): bool $emit
	 */
	public function transferStream(EndpointEntity $endpoint, string $userId, array $job, callable $emit, string $prefer = '', string $sudoPassword = ''): void {
		$up = ($job['direction'] ?? 'down') === 'up';
		$session = $this->open($endpoint, $sudoPassword, $prefer);
		try {
			if ($up) {
				$this->uploadReported($session, $endpoint, $userId, $job, $emit);
			} else {
				$this->downloadReported($session, $endpoint, $userId, $job, $emit);
			}
		} finally {
			$this->close($session);
		}
	}

	/**
	 * A ticker that reports at most five times a second.
	 *
	 * Every chunk of a fast transfer would be hundreds of lines a second, which
	 * costs more than it tells anybody. The last count is always sent, so the
	 * bar finishes where the file does.
	 *
	 * @param callable(array<string, mixed>): bool $emit
	 * @return callable(int, bool): bool
	 */
	private function ticker(callable $emit, int $total, float $started): callable {
		$last = 0.0;
		return static function (int $done, bool $force = false) use ($emit, $total, $started, &$last): bool {
			$now = microtime(true);
			if (!$force && $now - $last < 0.2) {
				return true;
			}
			$last = $now;
			$seconds = max(0.001, $now - $started);
			$rate = $done / $seconds;
			return $emit([
				'stage' => 'progress',
				'done' => $done,
				'total' => $total,
				'seconds' => round($seconds, 2),
				'bytesPerSecond' => (int)round($rate),
				// Left to run, at the rate it has managed so far. Unknown while
				// the size is unknown, which is honest rather than a made-up 0.
				'secondsLeft' => $total > 0 && $rate > 0 ? (int)round(max(0, $total - $done) / $rate) : null,
			]);
		};
	}

	/**
	 * @param array<string, mixed> $session
	 * @param array<string, mixed> $job
	 * @param callable(array<string, mixed>): bool $emit
	 */
	private function downloadReported(array $session, EndpointEntity $endpoint, string $userId, array $job, callable $emit): void {
		$remote = $this->cleanPath((string)($job['remote'] ?? ''));
		if ($remote === '' || str_ends_with($remote, '/')) {
			throw new \InvalidArgumentException('Choose a file to download');
		}
		$folder = $this->userFolder($userId, (string)($job['target'] ?? 'NetBase'));
		$name = basename($remote);
		$target = $this->uniqueName($folder, $name);
		$total = $this->remoteSize($session, $remote) ?? 0;
		$started = microtime(true);
		$emit(['stage' => 'start', 'direction' => 'down', 'name' => $name, 'into' => $target, 'total' => $total]);
		$tick = $this->ticker($emit, $total, $started);

		$file = $folder->newFile($target);
		$out = $file->fopen('w');
		if (!is_resource($out)) {
			throw new \RuntimeException('Could not open the destination file in Nextcloud');
		}
		$done = 0;
		$finished = false;
		try {
			if ($session['kind'] === 'ftp') {
				// The non-blocking form hands back control between chunks, which
				// is the only place FTP will let anything be counted.
				$state = @ftp_nb_fget($session['handle'], $out, $remote, FTP_BINARY);
				while ($state === FTP_MOREDATA) {
					$done = (int)ftell($out);
					if (!$tick($done)) {
						throw new \RuntimeException('The transfer was stopped');
					}
					$state = @ftp_nb_continue($session['handle']);
				}
				if ($state !== FTP_FINISHED) {
					throw new \RuntimeException($this->l->t('The server refused to send %s', [$remote]));
				}
			} else {
				$handle = $session['handle'];
				if ($total <= 0) {
					throw new \RuntimeException($this->l->t('No such file: %s', [$remote]));
				}
				// SCP fetches the whole file on the first ranged read, so the
				// loop below would sit silent through all of it. Handing the
				// ticker in means the bar moves during that fetch, and Stop has
				// something to stop.
				if (method_exists($handle, 'setProgress')) {
					$handle->setProgress($tick);
				}
				for ($offset = 0; $offset < $total; $offset += self::CHUNK) {
					$chunk = @$handle->get($remote, false, $offset, min(self::CHUNK, $total - $offset));
					if ($chunk === false) {
						throw new \RuntimeException($this->l->t('The transfer stopped at %d bytes', [$offset]));
					}
					fwrite($out, $chunk);
					$done = (int)ftell($out);
					if (!$tick($done)) {
						throw new \RuntimeException('The transfer was stopped');
					}
				}
			}
			$done = (int)ftell($out);
			$finished = true;
		} finally {
			// This has to be a finally, not the catch it used to be. Stop closes
			// the browser's end of the stream, and this request runs with
			// ignore_user_abort(false) — deliberately, because that is what lets
			// connection_aborted() answer Stop at all. So PHP is killed mid-write
			// and no catch is ever entered: the handle stayed open, and with it
			// Nextcloud's lock on the file, which is why a stopped transfer left
			// a destination nothing could delete afterwards. A finally is run on
			// the way out of the block whichever way it is left.
			fclose($out);
			if (!$finished) {
				try {
					$folder->get($target)->delete();
				} catch (\Throwable) {
					// A half-written file is worse than none; if it cannot go,
					// say nothing more about it than the failure itself.
				}
			}
		}
		$this->refreshSize($file);
		$tick($done, true);
		$this->endpoints->touch($endpoint, 'Downloaded ' . $name);
		$emit([
			'stage' => 'done', 'direction' => 'down', 'name' => $name, 'into' => $target,
			'bytes' => $done, 'seconds' => round(microtime(true) - $started, 3),
			'path' => $folder->getInternalPath() . '/' . $target,
		]);
	}

	/**
	 * @param array<string, mixed> $session
	 * @param array<string, mixed> $job
	 * @param callable(array<string, mixed>): bool $emit
	 */
	private function uploadReported(array $session, EndpointEntity $endpoint, string $userId, array $job, callable $emit): void {
		$node = $this->localFile($userId, (string)($job['local'] ?? ''));
		$remoteDir = rtrim($this->cleanPath((string)($job['remote'] ?? '')), '/');
		$remote = $remoteDir . '/' . $node->getName();
		$total = (int)$node->getSize();
		$started = microtime(true);
		$emit(['stage' => 'start', 'direction' => 'up', 'name' => $node->getName(), 'into' => $remote, 'total' => $total]);
		$tick = $this->ticker($emit, $total, $started);

		$in = $node->fopen('r');
		if (!is_resource($in)) {
			throw new \RuntimeException('Could not read the source file');
		}
		$sent = 0;
		try {
			if ($session['kind'] === 'ftp') {
				$state = @ftp_nb_fput($session['handle'], $remote, $in, FTP_BINARY);
				while ($state === FTP_MOREDATA) {
					$sent = (int)ftell($in);
					if (!$tick($sent)) {
						throw new \RuntimeException('The transfer was stopped');
					}
					$state = @ftp_nb_continue($session['handle']);
				}
				if ($state !== FTP_FINISHED) {
					throw new \RuntimeException('The server refused the upload');
				}
			} else {
				$handle = $session['handle'];
				$callback = constant(get_class($handle) . '::SOURCE_CALLBACK');
				$stopped = false;
				// SCP stages the file on this server first and only then sends
				// it. Counting the staging as well would run the bar to 100%
				// before a single byte had left, so for SCP the count comes from
				// the send itself and the reader below stays quiet.
				$staged = method_exists($handle, 'setProgress');
				if ($staged) {
					$handle->setProgress($tick);
				}
				// SFTP asks for each block as it sends it, so counting here is
				// counting the send. SCP asks for them all first and sends
				// afterwards, so for SCP this only measures the staging and the
				// real count comes from setProgress above.
				$reader = static function (int $length) use ($in, &$sent, $tick, &$stopped, $staged): ?string {
					if ($stopped) {
						return null;
					}
					$data = fread($in, $length);
					if ($data === false || $data === '') {
						return null;
					}
					$sent += strlen($data);
					if (!$staged && !$tick($sent)) {
						$stopped = true;
						return null;
					}
					return $data;
				};
				if (!@$handle->put($remote, $reader, $callback)) {
					throw new \RuntimeException('The server refused the upload');
				}
				if ($stopped) {
					throw new \RuntimeException('The transfer was stopped');
				}
			}
			$sent = (int)ftell($in);
		} finally {
			fclose($in);
		}
		$tick($sent, true);
		$this->endpoints->touch($endpoint, 'Uploaded ' . $node->getName());
		$emit([
			'stage' => 'done', 'direction' => 'up', 'name' => $node->getName(), 'into' => $remote,
			'bytes' => $sent, 'seconds' => round(microtime(true) - $started, 3),
		]);
	}

	/**
	 * Tell Nextcloud how big a file it has just been handed.
	 *
	 * Writing through a stream handle puts the bytes on disk but leaves the
	 * file cache saying nothing changed, so the file shows as 0 B in the Files
	 * app and in this app's own left-hand pane until something rescans. That
	 * is not a display quirk: the size is wrong until it is corrected, and a
	 * transfer that reports success while the file reads as empty is worse
	 * than one that reports failure.
	 */
	private function refreshSize(File $file): void {
		try {
			$file->getStorage()->getScanner()->scanFile($file->getInternalPath());
		} catch (\Throwable $e) {
			// Nothing to do about it here, and nothing worth failing over: the
			// bytes are on disk either way and the next scan will agree.
			$this->logger->debug('NetBase: could not refresh the size of ' . $file->getName(), ['app' => 'netbase']);
		}
	}

	/** The size the far end reports, or null when it will not say. */
	private function remoteSize(array $session, string $path): ?int {
		if ($session['kind'] === 'ftp') {
			$size = @ftp_size($session['handle'], $path);
			return is_int($size) && $size >= 0 ? $size : null;
		}
		$handle = $session['handle'];
		$size = method_exists($handle, 'filesize') ? @$handle->filesize($path) : @$handle->size($path);
		return is_int($size) && $size >= 0 ? $size : null;
	}

	/** One file of the user's own, or a plain refusal naming what was asked for. */
	private function localFile(string $userId, string $path): File {
		$userFolder = $this->rootFolder->getUserFolder($userId);
		try {
			$node = $userFolder->get(ltrim($path, '/'));
		} catch (NotFoundException) {
			throw new \InvalidArgumentException($this->l->t('No such file in your Nextcloud files: %s', [$path]));
		}
		if (!$node instanceof File) {
			throw new \InvalidArgumentException('Only files can be uploaded, not folders');
		}
		return $node;
	}

	// ------------------------------------------------------------ text in a window

	/**
	 * A file's contents, as text, for reading and editing in a window.
	 *
	 * @return array<string, mixed>
	 */
	public function readText(EndpointEntity $endpoint, string $path, string $prefer = '', string $sudoPassword = ''): array {
		$path = $this->cleanPath($path);
		if ($path === '' || str_ends_with($path, '/')) {
			throw new \InvalidArgumentException('Choose a file to open');
		}
		$session = $this->open($endpoint, $sudoPassword, $prefer);
		try {
			$size = $this->remoteSize($session, $path);
			if ($size !== null && $size > self::TEXT_BYTES) {
				throw new \RuntimeException($this->l->t(
					'%1$s is %2$s. Only files up to 1 MB can be opened here — download it instead.',
					[basename($path), $this->readableSize($size)]
				));
			}
			$raw = $this->readWholeFile($session, $path);
			if ($raw === null) {
				throw new \RuntimeException($this->l->t('Could not read %s', [$path]));
			}
			if (strlen($raw) > self::TEXT_BYTES) {
				throw new \RuntimeException($this->l->t(
					'%1$s is %2$s. Only files up to 1 MB can be opened here — download it instead.',
					[basename($path), $this->readableSize(strlen($raw))]
				));
			}
			// A NUL byte in the first few kilobytes is the one reliable sign of
			// something that is not text. Showing it would fill the window with
			// rubbish and offer to save it back.
			if (str_contains(substr($raw, 0, 8000), "\0")) {
				throw new \RuntimeException($this->l->t('%s is not a text file.', [basename($path)]));
			}
			$encoding = $this->textEncoding($raw);
			$text = $encoding === 'UTF-8' ? $raw : (string)@mb_convert_encoding($raw, 'UTF-8', $encoding);
			return [
				'path' => $path,
				'name' => basename($path),
				'bytes' => strlen($raw),
				'encoding' => $encoding,
				'newline' => str_contains($raw, "\r\n") ? 'crlf' : 'lf',
				'text' => $text,
			];
		} finally {
			$this->close($session);
		}
	}

	/**
	 * Put edited text back, in the encoding and the line endings it arrived in.
	 *
	 * @return array<string, mixed>
	 */
	public function writeText(EndpointEntity $endpoint, string $path, string $text, string $encoding = 'UTF-8', string $newline = 'lf', string $prefer = '', string $sudoPassword = ''): array {
		$path = $this->cleanPath($path);
		if ($path === '' || str_ends_with($path, '/')) {
			throw new \InvalidArgumentException('Choose a file to save');
		}
		if (strlen($text) > self::TEXT_BYTES) {
			throw new \InvalidArgumentException($this->l->t('That is larger than the 1 MB this window can save.'));
		}
		$text = str_replace(["\r\n", "\r"], "\n", $text);
		if ($newline === 'crlf') {
			$text = str_replace("\n", "\r\n", $text);
		}
		if ($encoding !== 'UTF-8' && in_array($encoding, self::TEXT_ENCODINGS, true)) {
			$converted = @mb_convert_encoding($text, $encoding, 'UTF-8');
			if (is_string($converted)) {
				$text = $converted;
			}
		}
		$session = $this->open($endpoint, $sudoPassword, $prefer);
		$started = microtime(true);
		try {
			if ($session['kind'] === 'ftp') {
				$tmp = fopen('php://temp', 'w+b');
				if (!is_resource($tmp)) {
					throw new \RuntimeException('No temporary buffer could be made on this server');
				}
				fwrite($tmp, $text);
				rewind($tmp);
				$ok = @ftp_fput($session['handle'], $path, $tmp, FTP_BINARY);
				fclose($tmp);
				if (!$ok) {
					throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['save', $path]));
				}
			} elseif (!@$session['handle']->put($path, $text)) {
				throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['save', $path]));
			}
			$this->endpoints->touch($endpoint, 'Saved ' . basename($path));
			return ['ok' => true, 'path' => $path, 'bytes' => strlen($text), 'seconds' => round(microtime(true) - $started, 3)];
		} finally {
			$this->close($session);
		}
	}

	/** Which of the likely encodings this actually is. */
	private function textEncoding(string $raw): string {
		if ($raw === '' || mb_check_encoding($raw, 'UTF-8')) {
			return 'UTF-8';
		}
		$found = mb_detect_encoding($raw, self::TEXT_ENCODINGS, true);
		return is_string($found) && $found !== '' ? $found : 'Windows-1252';
	}

	/** A size a person can read, for a refusal that has to explain itself. */
	private function readableSize(int $bytes): string {
		$units = ['B', 'kB', 'MB', 'GB'];
		$value = (float)$bytes;
		$i = 0;
		while ($value >= 1024 && $i < count($units) - 1) {
			$value /= 1024;
			$i++;
		}
		return ($i === 0 ? (string)$bytes : number_format($value, 1)) . ' ' . $units[$i];
	}

	// ------------------------------------------------------------ a folder, upwards

	/**
	 * A folder of the user's own files, sent whole.
	 *
	 * The downward direction has been a single ZIP since it was asked for; this
	 * is the same journey the other way, and it walks rather than packs because
	 * the far end has no way to unpack anything.
	 *
	 * @param callable(array<string, mixed>): bool $emit
	 */
	public function uploadFolder(EndpointEntity $endpoint, string $userId, string $sourcePath, string $remoteDir, callable $emit, string $prefer = '', string $sudoPassword = ''): void {
		$userFolder = $this->rootFolder->getUserFolder($userId);
		try {
			$node = $userFolder->get(ltrim($sourcePath, '/'));
		} catch (NotFoundException) {
			throw new \InvalidArgumentException($this->l->t('No such folder in your Nextcloud files: %s', [$sourcePath]));
		}
		if (!$node instanceof Folder) {
			throw new \InvalidArgumentException('That is a file, not a folder');
		}
		$session = $this->open($endpoint, $sudoPassword, $prefer);
		try {
			$count = 0;
			$bytes = 0;
			$this->sendFolder($session, $node, rtrim($this->cleanPath($remoteDir), '/') . '/' . $node->getName(), $emit, 0, $count, $bytes);
			$this->endpoints->touch($endpoint, 'Uploaded folder ' . $node->getName());
			$emit(['stage' => 'done', 'direction' => 'up', 'name' => $node->getName(), 'files' => $count, 'bytes' => $bytes]);
		} finally {
			$this->close($session);
		}
	}

	/**
	 * @param array<string, mixed> $session
	 * @param callable(array<string, mixed>): bool $emit
	 */
	private function sendFolder(array $session, Folder $folder, string $remote, callable $emit, int $depth, int &$count, int &$bytes): void {
		if ($depth > self::ZIP_DEPTH) {
			throw new \RuntimeException($this->l->t('The folders go deeper than one transfer allows.'));
		}
		if ($session['kind'] === 'ftp') {
			@ftp_mkdir($session['handle'], $remote);
		} else {
			@$session['handle']->mkdir($remote);
		}
		foreach ($folder->getDirectoryListing() as $child) {
			if ($child instanceof Folder) {
				$this->sendFolder($session, $child, $remote . '/' . $child->getName(), $emit, $depth + 1, $count, $bytes);
				continue;
			}
			if (!$child instanceof File) {
				continue;
			}
			if ($count >= self::ZIP_FILES || $bytes >= self::ZIP_BYTES) {
				throw new \RuntimeException($this->l->t('The folder is larger than one transfer allows.'));
			}
			$target = $remote . '/' . $child->getName();
			$started = microtime(true);
			$emit(['stage' => 'start', 'direction' => 'up', 'name' => $child->getName(), 'into' => $target, 'total' => (int)$child->getSize()]);
			$tick = $this->ticker($emit, (int)$child->getSize(), $started);
			$in = $child->fopen('r');
			if (!is_resource($in)) {
				throw new \RuntimeException($this->l->t('Could not read %s', [$child->getName()]));
			}
			$sent = 0;
			try {
				if ($session['kind'] === 'ftp') {
					if (!@ftp_fput($session['handle'], $target, $in, FTP_BINARY)) {
						throw new \RuntimeException('The server refused the upload');
					}
				} else {
					$callback = constant(get_class($session['handle']) . '::SOURCE_CALLBACK');
					$reader = static function (int $length) use ($in, &$sent, $tick): ?string {
						$data = fread($in, $length);
						if ($data === false || $data === '') {
							return null;
						}
						$sent += strlen($data);
						$tick($sent);
						return $data;
					};
					if (!@$session['handle']->put($target, $reader, $callback)) {
						throw new \RuntimeException('The server refused the upload');
					}
				}
				$sent = (int)ftell($in);
			} finally {
				fclose($in);
			}
			$count++;
			$bytes += $sent;
			$tick($sent, true);
			$emit(['stage' => 'file', 'direction' => 'up', 'name' => $child->getName(), 'into' => $target, 'bytes' => $sent]);
		}
	}

	// ------------------------------------------------------------------ housekeeping

	public function manage(EndpointEntity $endpoint, string $action, string $path, string $extra = '', string $sudoPassword = '', string $prefer = ''): array {
		$path = $this->cleanPath($path);
		if ($path === '' || $path === '/') {
			throw new \InvalidArgumentException('Refusing to act on the root directory');
		}
		$session = $this->open($endpoint, $sudoPassword, $prefer);
		try {
			$ftp = $session['kind'] === 'ftp';
			$handle = $session['handle'];
			$ok = match ($action) {
				'mkdir' => $ftp ? @ftp_mkdir($handle, $path) !== false : @$handle->mkdir($path),
				// A folder goes with everything under it. Plain rmdir only ever
				// removed an empty one and refused the rest, which read as the
				// delete having quietly done nothing. The reader is told what
				// is inside before this is called.
				//
				// FTP is the exception, and stays as it was. It has no
				// recursive delete, so the walk has to be done here one call at
				// a time — and a walk that fails halfway cannot put back what it
				// has already removed. A listing that fails mid-way (FTP data
				// connections fail often) left part of the tree gone while the
				// reader was told only "the server refused", which is worse than
				// refusing outright. Until that is given a safe shape, FTP
				// removes an empty folder and refuses the rest, honestly.
				'rmdir' => $ftp ? @ftp_rmdir($handle, $path) : @$handle->delete($path, true),
				'delete' => $ftp ? @ftp_delete($handle, $path) : @$handle->delete($path, false),
				'rename' => $ftp ? @ftp_rename($handle, $path, $this->cleanPath($extra)) : @$handle->rename($path, $this->cleanPath($extra)),
				'chmod' => $ftp ? @ftp_chmod($handle, (int)octdec($extra ?: '644'), $path) !== false : @$handle->chmod((int)octdec($extra ?: '644'), $path),
				// The owner, the group and the timestamp. FTP has no notion of
				// any of them; SCP does it through the shell, which means it
				// works as root and is refused otherwise, exactly as it should.
				'chown' => $ftp ? false : @$handle->chown($path, $extra),
				'chgrp' => $ftp ? false : @$handle->chgrp($path, $extra),
				'touch' => $ftp ? false : @$handle->touch($path, $extra === '' ? null : (int)$extra),
				default => throw new \InvalidArgumentException('Unknown action'),
			};
			if (!$ok) {
				// "The server refused" says nothing about why. Over FTP the
				// usual reason is the one thing the reader can act on: the
				// folder still holds something.
				if ($ftp && $action === 'rmdir' && $this->ftpHoldsSomething($handle, $path)) {
					throw new \RuntimeException($this->l->t('%s is not empty. Over FTP only an empty folder can be removed, so delete what is inside it first.', [$path]));
				}
				throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', [$action, $path]));
			}
			$this->endpoints->touch($endpoint, $action . ' ' . $path);
			return ['ok' => true, 'action' => $action, 'path' => $path];
		} finally {
			$this->close($session);
		}
	}

	/**
	 * Whether an FTP folder still holds anything, asked only to explain a
	 * refusal that has already happened.
	 *
	 * The listing can fail on its own — FTP data connections often do — and a
	 * failure here must not replace the refusal the caller is reporting with
	 * something worse. So it is caught, and the plain refusal stands.
	 */
	private function ftpHoldsSomething(object $handle, string $path): bool {
		try {
			return $this->readDir(['kind' => 'ftp', 'handle' => $handle], $path) !== [];
		} catch (\Throwable $e) {
			return false;
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
	/**
	 * Keep a result in the person's own Nextcloud files.
	 *
	 * A finding is worth little if it only lives on the screen it appeared on.
	 * This writes it where the rest of their work is, next to the ticket or the
	 * report it belongs to, and never over something already there.
	 *
	 * @return array{path: string, name: string, bytes: int}
	 */
	public function saveToFiles(string $userId, string $folder, string $name, string $content): array {
		if (strlen($content) > 33554432) {
			throw new \InvalidArgumentException('That is too large to save');
		}
		$name = trim(str_replace(['/', '\\', "\0"], '', $name));
		if ($name === '' || str_starts_with($name, '.')) {
			throw new \InvalidArgumentException('Not a valid file name');
		}
		$userFolder = $this->rootFolder->getUserFolder($userId);
		$folder = trim(str_replace(['..', '\\'], '', $folder), '/');
		$target = $folder === '' ? $userFolder : (
			$userFolder->nodeExists($folder)
				? $userFolder->get($folder)
				: $userFolder->newFolder($folder)
		);
		if (!$target instanceof \OCP\Files\Folder) {
			throw new \InvalidArgumentException('That is not a folder');
		}

		// Never over the top of something already saved.
		$final = $name;
		$stem = pathinfo($name, PATHINFO_FILENAME);
		$extension = pathinfo($name, PATHINFO_EXTENSION);
		for ($n = 2; $target->nodeExists($final) && $n < 200; $n++) {
			$final = $stem . ' (' . $n . ')' . ($extension !== '' ? '.' . $extension : '');
		}
		$file = $target->newFile($final);
		$file->putContent($content);

		return [
			'path' => ltrim(substr($file->getPath(), strlen($userFolder->getPath())), '/'),
			'name' => $final,
			'bytes' => strlen($content),
		];
	}

	/**
	 * @param bool $create make the folder if it is not there yet.
	 *
	 * Only the file transfer screen asks for this, and only for the folder
	 * downloads land in: that folder is made by the first download anyway, so
	 * refusing to *show* it beforehand meant a red banner on every connection
	 * until something had been received. Browsing never creates anything.
	 */
	public function browseNextcloud(string $userId, string $path = '', bool $foldersOnly = false, bool $create = false): array {
		$userFolder = $this->rootFolder->getUserFolder($userId);
		$path = trim($path, '/');
		$node = $path === '' ? $userFolder : null;
		if ($node === null) {
			try {
				$node = $userFolder->get($path);
			} catch (NotFoundException) {
				if (!$create) {
					throw new \InvalidArgumentException($this->l->t('No such folder in your Nextcloud files: %s', [$path]));
				}
				$node = $userFolder->newFolder($path);
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
