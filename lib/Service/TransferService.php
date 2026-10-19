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

	/** The largest speed test, in MiB: one TiB. */
	private const SPEED_MAX_MB = 1048576;

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
		// Acting as another account works through sudo, which only SCP's shell
		// can reach. An SSH or SFTP connection asked to do that is opened over
		// SCP rather than quietly doing the work as the account signed in.
		if (($this->sudoUser !== '' || $sudoPassword !== '') && in_array($kind, ['ssh', 'sftp'], true)) {
			$kind = 'scp';
		}
		// checked again where it is used: a connection may have been saved before the fence (review X3)
		$host = \OCP\Server::get(ToolService::class)->reach((string)$endpoint->getHost());
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
		$session = new ScpSession($scp, $sudoPassword, $this->sudoUser);
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
			return ['ok' => false, 'error' => $this->l->said($e), 'seconds' => round(microtime(true) - $started, 3)];
		}
	}

	// ------------------------------------------------------------------ browsing

	/** @return array<string, mixed> */
	public function listDirectory(EndpointEntity $endpoint, string $path = '', string $sudoPassword = '', string $prefer = ''): array {
		$session = $this->open($endpoint, $sudoPassword, $prefer);
		try {
			// "~" is the home of the account acting: where switching to another
			// user lands (www-data in /var/www, not in the signed-in account's home).
			if (trim($path) === '~') {
				$path = $session['kind'] === 'scp' ? $session['handle']->home() : '';
				if ($path === '') {
					$path = $session['kind'] === 'ftp' ? (@ftp_pwd($session['handle']) ?: '/') : ((string)$session['handle']->pwd() ?: '/');
				}
			}
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
		$links = 0;
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
				// A symbolic link is shown as one, and opens like a folder when
				// it leads to one. Finding out costs a request per link, so only
				// the first hundred in a folder are asked about.
				$isLink = (int)($item['type'] ?? 0) === 3;
				if ($isLink && $links++ < 100) {
					$isDir = $this->linkIsDir($session, $this->joinRemote($path === '' ? '.' : $path, (string)$name));
				}
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
					'link' => $isLink,
					'target' => $isLink ? ($item['target'] ?? $this->linkTarget($session, $this->joinRemote($path === '' ? '.' : $path, (string)$name))) : null,
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
				$target = null;
				if ($m[1] === 'l' && str_contains($name, ' -> ')) {
					[$name, $target] = explode(' -> ', $name, 2);
				}
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
					'target' => $target,
				];
			} elseif (trim($line) !== '' && !preg_match('/^total\s/i', $line)) {
				$entries[] = ['name' => trim($line), 'directory' => false, 'size' => null, 'modified' => null, 'permissions' => null, 'owner' => null, 'raw' => true];
			}
		}
		return $entries;
	}

	/** Whether a link leads to a folder. */
	private function linkIsDir(array $session, string $path): bool {
		try {
			$h = $session['handle'];
			if ($session['kind'] === 'scp') {
				return str_contains($h->run('test -d ' . escapeshellarg($path) . ' && echo netbase-dir'), 'netbase-dir');
			}
			return method_exists($h, 'is_dir') && (bool)@$h->is_dir($path);
		} catch (\Throwable $e) {
			return false;
		}
	}

	/** Where a link points, where the protocol says (SFTP readlink). */
	private function linkTarget(array $session, string $path): ?string {
		try {
			$h = $session['handle'];
			$t = method_exists($h, 'readlink') ? @$h->readlink($path) : false;
			return is_string($t) && $t !== '' ? $t : null;
		} catch (\Throwable $e) {
			return null;
		}
	}

	/**
	 * The encoding conversion for files in the reader's own Nextcloud — the
	 * left pane. Overwriting keeps the file's id, shares and versions, as
	 * saving from an editor would; a copy goes beside it.
	 *
	 * @param list<string> $paths
	 * @return array<string, mixed>
	 */
	public function localText(string $userId, string $action, array $paths, array $op): array {
		$userFolder = $this->rootFolder->getUserFolder($userId);
		$files = [];
		$done = 0;
		$same = 0;
		$errors = [];
		$results = [];
		$lost = [];
		foreach ($paths as $raw) {
			$path = trim($this->cleanPath((string)$raw), '/');
			$name = basename($path);
			$row = ['path' => $path, 'name' => $name];
			try {
				$node = $path === '' ? null : $userFolder->get($path);
			} catch (NotFoundException) {
				$node = null;
			}
			if (!$node instanceof File) {
				$row['error'] = $node === null ? $this->l->t('%s is no longer there.', [$name]) : $this->l->t('%s is a folder; choose the files in it.', [$name]);
			} elseif ($node->getSize() > TextConvert::MAX_BYTES) {
				$row['error'] = $this->l->t('%1$s is larger than %2$s, too large to convert here.', [$name, $this->readableSize(TextConvert::MAX_BYTES)]);
			}
			if (isset($row['error'])) {
				$action === 'inspect' ? $files[] = $row : $errors[] = $row['error'];
				continue;
			}
			$data = $node->getContent();
			if ($action === 'inspect') {
				$files[] = $row + TextConvert::inspect($data, (string)($op['encFrom'] ?? 'auto'));
				continue;
			}
			try {
				$r = TextConvert::convert($data, (string)($op['encFrom'] ?? 'auto'), (string)($op['encTo'] ?? 'keep'), (string)($op['newline'] ?? 'keep'), (string)($op['bom'] ?? 'keep'), !empty($op['allowLoss']));
			} catch (TextConvertException $e) {
				$errors[] = $this->textError($e, $name);
				if ($e->reason === 'lost') {
					$lost[] = ['path' => $path, 'name' => $name, 'chars' => $e->lost];
				}
				continue;
			}
			if (!$r['changed']) {
				$same++;
				$results[] = ['path' => $path, 'unchanged' => true];
				continue;
			}
			if (($op['output'] ?? 'copy') === 'overwrite') {
				$node->putContent($r['bytes']);
				$saved = $path;
			} else {
				$parent = $node->getParent();
				$copy = self::convertedName($name, $op);
				if ($parent->nodeExists($copy)) {
					$copy = $this->uniqueName($parent, $copy);
				}
				$parent->newFile($copy, $r['bytes']);
				$saved = ltrim(($this->dirOf($path) === '' ? '' : $this->dirOf($path) . '/') . $copy, '/');
			}
			$done++;
			$results[] = ['path' => $path, 'saved' => $saved, 'from' => $r['from'], 'to' => $r['to'], 'newline' => $r['newline'], 'bom' => $r['bom'], 'replaced' => $r['lost']];
		}
		return $action === 'inspect' ? ['files' => $files] : ['done' => $done, 'skipped' => $same, 'errors' => $errors, 'results' => $results, 'lost' => $lost];
	}

	/**
	 * New folder, rename and delete on the reader's own Nextcloud side of the
	 * file transfer screen — the left pane, as FileZilla's local side. A
	 * deleted file goes to the Nextcloud trash, as it would from Files.
	 *
	 * @return array<string, mixed>
	 */
	public function localOp(string $userId, string $action, string $path, string $name = ''): array {
		$userFolder = $this->rootFolder->getUserFolder($userId);
		$path = trim($this->cleanPath($path), '/');
		$clean = trim(str_replace(['/', '\\', "\0", "\r", "\n"], '', $name));
		if (in_array($action, ['mkdir', 'rename'], true) && ($clean === '' || $clean === '.' || $clean === '..')) {
			throw new \InvalidArgumentException('Not a valid file name');
		}
		if ($action === 'mkdir') {
			$folder = $path === '' ? $userFolder : $userFolder->get($path);
			if (!$folder instanceof Folder) {
				throw new \InvalidArgumentException('The destination is a file, not a folder');
			}
			if ($folder->nodeExists($clean)) {
				throw new \RuntimeException($this->l->t('%s is already there.', [$clean]));
			}
			$folder->newFolder($clean);
			return ['ok' => true, 'path' => ltrim($path . '/' . $clean, '/')];
		}
		if ($path === '') {
			throw new \InvalidArgumentException('Refusing to act on the root directory');
		}
		try {
			$node = $userFolder->get($path);
		} catch (NotFoundException) {
			throw new \RuntimeException($this->l->t('%s is no longer there.', [$path]));
		}
		if ($action === 'rename') {
			$parent = $this->dirOf($path);
			$to = ltrim(($parent === '' || $parent === '/' ? '' : $parent . '/') . $clean, '/');
			if ($userFolder->nodeExists($to)) {
				throw new \RuntimeException($this->l->t('%s is already there.', [$clean]));
			}
			$node->move($userFolder->getPath() . '/' . $to);
			return ['ok' => true, 'path' => $to];
		}
		if ($action === 'delete') {
			$node->delete();
			return ['ok' => true];
		}
		throw new \InvalidArgumentException('Unknown action');
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
	private function addFolderToZip(array $session, \ZipArchive|\PharData $zip, string $remote, string $inside, int $depth,
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
	 * What to do where a file of the same name is already at the destination.
	 *
	 * The choices are FileZilla's: overwrite; overwrite only if the one being
	 * sent is newer, or only if the sizes differ; resume, sending only what the
	 * destination lacks; keep both under a new name; skip. 'ask' — the default —
	 * transfers nothing and reports the clash, so the reader chooses.
	 *
	 * A comparison that cannot be made (a server that gives no times) skips
	 * rather than overwrites: losing a file because a date was missing would
	 * be the worse mistake.
	 *
	 * @return string write | append | rename | skip | ask
	 */
	private function decide(string $policy, ?int $hereSize, ?int $hereTime, ?int $thereSize, ?int $thereTime, bool $canResume): string {
		return match ($policy) {
			'overwrite' => 'write',
			'skip' => 'skip',
			'rename' => 'rename',
			'newer' => $hereTime !== null && $thereTime !== null && $hereTime > $thereTime ? 'write' : 'skip',
			'size' => $hereSize !== null && $thereSize !== null && $hereSize === $thereSize ? 'skip' : 'write',
			'resume' => $hereSize !== null && $thereSize !== null && $thereSize === $hereSize
				? 'skip'
				: ($canResume && $hereSize !== null && $thereSize !== null && $thereSize < $hereSize ? 'append' : 'write'),
			default => 'ask',
		};
	}

	/** Bytes per second a job may use, from the KB/s the screen sends; 0 for no limit. */
	private function limitOf(array $job): int {
		return max(0, (int)($job['rate'] ?? 0)) * 1024;
	}

	/**
	 * Hold a transfer to its limit: sleep until the bytes so far are no ahead
	 * of the time so far. Called with each chunk.
	 */
	private static function throttle(int $limit, int $done, float $started): void {
		if ($limit <= 0) {
			return;
		}
		$ahead = $done / $limit - (microtime(true) - $started);
		if ($ahead > 0.01) {
			usleep((int)min(2000000, $ahead * 1000000));
		}
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
		$entry = $this->entryOf($session, $remote);
		$total = $this->remoteSize($session, $remote) ?? (int)($entry['size'] ?? 0);
		$remoteTime = isset($entry['modified']) ? (int)$entry['modified'] : null;
		$target = str_replace(['/', "\0"], '_', $name) ?: 'download';
		$existing = $folder->nodeExists($target) ? $folder->get($target) : null;
		$how = 'new';
		if ($existing !== null) {
			$isFile = $existing instanceof File;
			$how = $isFile
				? $this->decide((string)($job['onExists'] ?? 'ask'), $total, $remoteTime, (int)$existing->getSize(), (int)$existing->getMTime(), $session['kind'] !== 'scp')
				: 'rename';
			if ($how === 'ask') {
				$emit(['stage' => 'exists', 'direction' => 'down', 'name' => $name, 'path' => $target, 'directory' => false,
					'size' => (int)$existing->getSize(), 'modified' => (int)$existing->getMTime(), 'sourceSize' => $total, 'sourceModified' => $remoteTime]);
				return;
			}
			if ($how === 'skip') {
				$emit(['stage' => 'done', 'direction' => 'down', 'name' => $name, 'into' => $target, 'bytes' => 0, 'skipped' => true]);
				return;
			}
			if ($how === 'rename') {
				$target = $this->uniqueName($folder, $target);
				$existing = null;
				$how = 'new';
			}
		}
		$started = microtime(true);
		$emit(['stage' => 'start', 'direction' => 'down', 'name' => $name, 'into' => $target, 'total' => $total]);
		$tick = $this->ticker($emit, $total, $started);
		$limit = $this->limitOf($job);

		// Over an existing file the bytes first go to a file beside it, and are
		// copied in only once they have all arrived: a transfer that fails
		// half-way must not leave the reader's file half-overwritten. Copying in
		// (rather than renaming over) keeps the file's id, its shares and its
		// versions. Resuming appends to the file that is there, which is the
		// part that arrived before.
		$offset = 0;
		if ($how === 'append' && $existing instanceof File) {
			$file = $existing;
			$out = $file->fopen('a');
			$offset = (int)$existing->getSize();
			if (!is_resource($out)) {
				$how = 'write';
			}
		}
		$part = null;
		if ($how === 'write') {
			// Not ".part": Nextcloud treats a name ending so as its own upload in
			// progress and will not let it be read back.
			$part = $this->uniqueName($folder, $target . '.netbase-tmp');
			$file = $folder->newFile($part);
			$out = $file->fopen('w');
			$offset = 0;
		} elseif ($how === 'new') {
			$file = $folder->newFile($target);
			$out = $file->fopen('w');
		}
		if (!is_resource($out)) {
			throw new \RuntimeException('Could not open the destination file in Nextcloud');
		}
		$done = $offset;
		$finished = false;
		try {
			if ($session['kind'] === 'ftp') {
				// The non-blocking form hands back control between chunks, which
				// is the only place FTP will let anything be counted.
				$state = @ftp_nb_fget($session['handle'], $out, $remote, FTP_BINARY, $offset);
				while ($state === FTP_MOREDATA) {
					$done = $offset + (int)ftell($out);
					self::throttle($limit, $done - $offset, $started);
					if (!$tick($done)) {
						throw new \RuntimeException('The transfer was stopped');
					}
					$state = @ftp_nb_continue($session['handle']);
				}
				if ($state !== FTP_FINISHED) {
					throw new \RuntimeException($this->l->t('The server refused to send %s', [$remote]));
				}
				$done = $offset + (int)ftell($out);
			} else {
				$handle = $session['handle'];
				if ($total <= 0 && $entry === null) {
					throw new \RuntimeException($this->l->t('No such file: %s', [$remote]));
				}
				// SCP fetches the whole file on the first ranged read, so the
				// loop below would sit silent through all of it. Handing the
				// ticker in means the bar moves during that fetch, and Stop has
				// something to stop.
				if (method_exists($handle, 'setProgress')) {
					$handle->setProgress($tick);
				}
				for ($at = $offset; $at < $total; $at += self::CHUNK) {
					$chunk = @$handle->get($remote, false, $at, min(self::CHUNK, $total - $at));
					if ($chunk === false) {
						throw new \RuntimeException($this->l->t('The transfer stopped at %d bytes', [$at]));
					}
					fwrite($out, $chunk);
					$done = $at + strlen($chunk);
					self::throttle($limit, $done - $offset, $started);
					if (!$tick($done)) {
						throw new \RuntimeException('The transfer was stopped');
					}
				}
			}
			$finished = true;
		} finally {
			// Stop closes the browser's end of the stream. The request ignores the
			// abort, so the next report sees connection_aborted() and throws, and this
			// finally closes the handle (and Nextcloud's lock on the file) and removes
			// the half-written file. With ignore_user_abort(false) PHP was killed
			// mid-write and not even a finally ran (review A1).
			fclose($out);
			if (!$finished && $how !== 'append') {
				try {
					$folder->get($part ?? $target)->delete();
				} catch (\Throwable) {
					// A half-written file is worse than none; if it cannot go,
					// say nothing more about it than the failure itself.
				}
			}
		}
		if ($part !== null && $existing instanceof File) {
			$in = $file->fopen('r');
			$into = $existing->fopen('w');
			if (!is_resource($in) || !is_resource($into)) {
				throw new \RuntimeException('Could not write into your Nextcloud files');
			}
			stream_copy_to_stream($in, $into);
			fclose($in);
			fclose($into);
			$file->delete();
			$file = $existing;
		}
		$this->refreshSize($file);
		if (!empty($job['keepTime']) && $remoteTime !== null) {
			try {
				$file->touch($remoteTime);
			} catch (\Throwable $e) {
				// The time is a nicety; the file is what was asked for.
			}
		}
		$tick($done, true);
		$this->endpoints->touch($endpoint, 'Downloaded ' . $name);
		$emit([
			'stage' => 'done', 'direction' => 'down', 'name' => $name, 'into' => $target,
			'bytes' => $done - $offset, 'seconds' => round(microtime(true) - $started, 3),
			'path' => $folder->getInternalPath() . '/' . $target, 'resumedAt' => $offset,
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
		$remote = $this->joinRemote($remoteDir, $node->getName());
		$total = (int)$node->getSize();
		$there = $this->entryOf($session, $remote);
		$offset = 0;
		if ($there !== null) {
			if (!empty($there['directory'])) {
				throw new \RuntimeException($this->l->t('%s: a file and a folder cannot replace each other.', [$node->getName()]));
			}
			$how = $this->decide((string)($job['onExists'] ?? 'ask'), $total, (int)$node->getMTime(),
				isset($there['size']) ? (int)$there['size'] : null, isset($there['modified']) ? (int)$there['modified'] : null, $session['kind'] !== 'scp');
			if ($how === 'ask') {
				$emit(['stage' => 'exists', 'direction' => 'up', 'name' => $node->getName(), 'path' => $remote, 'directory' => false,
					'size' => $there['size'] ?? null, 'modified' => $there['modified'] ?? null, 'sourceSize' => $total, 'sourceModified' => (int)$node->getMTime()]);
				return;
			}
			if ($how === 'skip') {
				$emit(['stage' => 'done', 'direction' => 'up', 'name' => $node->getName(), 'into' => $remote, 'bytes' => 0, 'skipped' => true]);
				return;
			}
			if ($how === 'rename') {
				$remote = $this->uniqueRemote($session, $remoteDir, $node->getName());
			}
			if ($how === 'append') {
				$offset = (int)$there['size'];
			}
		}
		$started = microtime(true);
		$emit(['stage' => 'start', 'direction' => 'up', 'name' => $node->getName(), 'into' => $remote, 'total' => $total]);
		$tick = $this->ticker($emit, $total, $started);
		$limit = $this->limitOf($job);

		$in = $node->fopen('r');
		if (!is_resource($in)) {
			throw new \RuntimeException('Could not read the source file');
		}
		if ($offset > 0 && @fseek($in, $offset) !== 0) {
			// A source that cannot seek is sent whole instead.
			fclose($in);
			$in = $node->fopen('r');
			$offset = 0;
		}
		$sent = $offset;
		try {
			if ($session['kind'] === 'ftp') {
				$state = @ftp_nb_fput($session['handle'], $remote, $in, FTP_BINARY, $offset);
				while ($state === FTP_MOREDATA) {
					$sent = (int)ftell($in);
					self::throttle($limit, $sent - $offset, $started);
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
				$reader = static function (int $length) use ($in, &$sent, $tick, &$stopped, $staged, $limit, $offset, $started): ?string {
					if ($stopped) {
						return null;
					}
					$data = fread($in, $length);
					if ($data === false || $data === '') {
						return null;
					}
					$sent += strlen($data);
					if (!$staged) {
						self::throttle($limit, $sent - $offset, $started);
						if (!$tick($sent)) {
							$stopped = true;
							return null;
						}
					}
					return $data;
				};
				// Resuming writes from the size already there; the source was
				// moved to the same place above.
				$ok = $offset > 0 && !$staged
					? @$handle->put($remote, $reader, $callback, $offset)
					: @$handle->put($remote, $reader, $callback);
				if (!$ok) {
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
		if (!empty($job['keepTime'])) {
			$this->setRemoteTime($session, $remote, (int)$node->getMTime());
		}
		$tick($sent, true);
		$this->endpoints->touch($endpoint, 'Uploaded ' . $node->getName());
		$emit([
			'stage' => 'done', 'direction' => 'up', 'name' => $node->getName(), 'into' => $remote,
			'bytes' => $sent - $offset, 'seconds' => round(microtime(true) - $started, 3), 'resumedAt' => $offset,
		]);
	}

	/** Give a sent file the time the original has, where the protocol allows it. */
	private function setRemoteTime(array $session, string $remote, int $time): void {
		try {
			if ($session['kind'] === 'ftp') {
				// MFMT is an extension (draft-somers-ftp-mfxx); a server without it says so and nothing changes.
				@ftp_raw($session['handle'], 'MFMT ' . gmdate('YmdHis', $time) . ' ' . $remote);
			} elseif ($session['kind'] === 'scp') {
				$session['handle']->touch($remote, $time);
			} else {
				@$session['handle']->touch($remote, $time, $time);
			}
		} catch (\Throwable $e) {
			// The time is a nicety; the file is what was asked for.
		}
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
		$units = ['B', 'kB', 'MB', 'GB', 'TB'];
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
	public function uploadFolder(EndpointEntity $endpoint, string $userId, string $sourcePath, string $remoteDir, callable $emit, string $prefer = '', string $sudoPassword = '', array $job = []): void {
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
			$dir = rtrim($this->cleanPath($remoteDir), '/');
			$target = $this->joinRemote($dir, $node->getName());
			$policy = (string)($job['onExists'] ?? 'ask');
			// A folder of that name already there: the choice is asked once, for
			// the folder, and then applies to every file inside it.
			$there = $this->entryOf($session, $target);
			if ($there !== null) {
				if ($policy === 'ask') {
					$emit(['stage' => 'exists', 'direction' => 'up', 'name' => $node->getName(), 'path' => $target, 'directory' => true,
						'size' => null, 'modified' => $there['modified'] ?? null, 'sourceSize' => null, 'sourceModified' => (int)$node->getMTime()]);
					return;
				}
				if ($policy === 'skip') {
					$emit(['stage' => 'done', 'direction' => 'up', 'name' => $node->getName(), 'files' => 0, 'bytes' => 0, 'skipped' => true]);
					return;
				}
				if ($policy === 'rename' || empty($there['directory'])) {
					$target = $this->uniqueRemote($session, $dir, $node->getName());
					$policy = 'overwrite';
				}
			}
			$job['onExists'] = $policy === 'ask' ? 'overwrite' : $policy;
			$this->sendFolder($session, $node, $target, $emit, 0, $count, $bytes, $job);
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
	private function sendFolder(array $session, Folder $folder, string $remote, callable $emit, int $depth, int &$count, int &$bytes, array $job = []): void {
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
				$this->sendFolder($session, $child, $remote . '/' . $child->getName(), $emit, $depth + 1, $count, $bytes, $job);
				continue;
			}
			if (!$child instanceof File) {
				continue;
			}
			if ($count >= self::ZIP_FILES || $bytes >= self::ZIP_BYTES) {
				throw new \RuntimeException($this->l->t('The folder is larger than one transfer allows.'));
			}
			$target = $remote . '/' . $child->getName();
			$there = $this->entryOf($session, $target);
			if ($there !== null) {
				$how = $this->decide((string)$job['onExists'], (int)$child->getSize(), (int)$child->getMTime(),
					isset($there['size']) ? (int)$there['size'] : null, isset($there['modified']) ? (int)$there['modified'] : null, false);
				if ($how === 'skip') {
					$emit(['stage' => 'file', 'direction' => 'up', 'name' => $child->getName(), 'into' => $target, 'bytes' => 0, 'skipped' => true]);
					continue;
				}
				if ($how === 'rename') {
					$target = $this->uniqueRemote($session, $remote, $child->getName());
				}
			}
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
			if (!empty($job['keepTime'])) {
				$this->setRemoteTime($session, $target, (int)$child->getMTime());
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

	// ------------------------------------------------------------ work on the server

	/** The account to act as through sudo, for this request; '' acts as the one signed in. */
	private string $sudoUser = '';

	/** Listings already read in this request, by folder. */
	private array $listed = [];

	/** Whether each open connection can run commands, asked once. */
	private array $shells = [];
	/** @var array<int, list<string>|null> the archive tools each session's far end has */
	private array $archTools = [];

	/** Act as this account for the rest of the request. Checked here and again by ScpSession. */
	public function actAs(string $user): static {
		$user = trim($user);
		if ($user !== '' && !ScpSession::validUser($user)) {
			throw new \InvalidArgumentException('That is not an account name.');
		}
		$this->sudoUser = $user;
		return $this;
	}

	/**
	 * The work a file manager does on the server itself: copy, move, compress,
	 * open archives, change permissions, make an empty file, search, convert
	 * text files between encodings and line endings, and look entries up.
	 *
	 * Each answer is streamed, because copying a large folder or compressing
	 * one can take minutes, and a request that says nothing for that long is
	 * cut off by the web server and looks hung to the reader.
	 *
	 * Where a name is already taken the default is to ask: the first answer
	 * lists the clashes and does nothing, and the screen sends the same request
	 * again with the reader's choice — overwrite, skip, or a new name.
	 *
	 * @param array<string, mixed> $op
	 * @param callable(array<string, mixed>): bool $emit
	 */
	public function operate(EndpointEntity $endpoint, string $userId, array $op, callable $emit, string $prefer = '', string $sudoPassword = ''): void {
		$action = (string)($op['action'] ?? '');
		$paths = [];
		foreach ((array)($op['paths'] ?? []) as $p) {
			$p = $this->cleanPath((string)$p);
			if ($p !== '' && $p !== '/') {
				$paths[] = $p;
			}
		}
		$session = $this->open($endpoint, $sudoPassword, $prefer);
		$this->listed = [];
		try {
			$result = match ($action) {
				'stat' => $this->statAll($session, $paths),
				'copy', 'move' => $this->copyOrMove($session, $action, $paths, (string)($op['dest'] ?? ''), (string)($op['onExists'] ?? 'ask'), $emit),
				'compress' => $this->compress($session, $userId, $paths, $op, $emit),
				'archivers' => $this->archivers($session),
				'extract' => $this->extract($session, $paths, $op, $emit),
				'inspect' => $this->inspectText($session, $paths, $op),
				'convert' => $this->convertText($session, $paths, $op, $emit),
				'chmod' => $this->chmodAll($session, $paths, (string)($op['mode'] ?? ''), (string)($op['recurse'] ?? ''), $emit),
				'newfile' => $this->newEmptyFile($session, $paths[0] ?? ''),
				'search' => $this->search($session, (string)($op['path'] ?? ''), (string)($op['pattern'] ?? ''), $emit),
				default => throw new \InvalidArgumentException('Unknown action'),
			};
			if (!in_array($action, ['stat', 'search', 'archivers', 'inspect'], true)) {
				$this->endpoints->touch($endpoint, $action . ' ' . implode(', ', array_map('basename', $paths)));
			}
			$emit(['stage' => 'done', 'action' => $action] + $result);
		} finally {
			$this->close($session);
		}
	}

	/** @return array<string, mixed> */
	private function statAll(array $session, array $paths): array {
		$out = [];
		foreach ($paths as $p) {
			$e = $this->entryOf($session, $p);
			$out[] = [
				'path' => $p, 'exists' => $e !== null, 'directory' => $e !== null && !empty($e['directory']),
				'size' => $e['size'] ?? null, 'modified' => $e['modified'] ?? null,
			];
		}
		return ['entries' => $out];
	}

	/**
	 * Copy or move into another folder on the same server.
	 *
	 * Moving is a rename, which every protocol has. Copying needs a shell
	 * (cp); without one — FTP, or an SFTP-only account — each file is brought
	 * to this server and sent back, which is slower but gives the same result.
	 *
	 * @return array<string, mixed>
	 */
	private function copyOrMove(array $session, string $action, array $paths, string $dest, string $onExists, callable $emit): array {
		$dest = $this->cleanPath($dest);
		if (!in_array($onExists, ['ask', 'overwrite', 'skip', 'rename'], true)) {
			$onExists = 'ask';
		}
		$plan = [];
		$conflicts = [];
		foreach ($paths as $src) {
			$entry = $this->entryOf($session, $src);
			if ($entry === null) {
				throw new \RuntimeException($this->l->t('%s is no longer there.', [$src]));
			}
			$isDir = !empty($entry['directory']);
			$target = $this->joinRemote($dest, basename($src));
			if ($isDir && $target !== $src && str_starts_with($dest . '/', $src . '/')) {
				throw new \RuntimeException($this->l->t('%s cannot go into a folder inside itself.', [basename($src)]));
			}
			if ($target === $src) {
				if ($action === 'move') {
					continue;
				}
				// A copy into the folder it is already in can only be a copy under a new name.
				$plan[] = [$src, $target, $isDir, $entry, true];
				continue;
			}
			$there = $this->entryOf($session, $target);
			$plan[] = [$src, $target, $isDir, $there, false];
			if ($there !== null) {
				$conflicts[] = [
					'name' => basename($src), 'path' => $target, 'directory' => !empty($there['directory']),
					'size' => $there['size'] ?? null, 'modified' => $there['modified'] ?? null,
					'sourceSize' => $entry['size'] ?? null, 'sourceModified' => $entry['modified'] ?? null,
				];
			}
		}
		if ($conflicts !== [] && $onExists === 'ask') {
			return ['conflicts' => $conflicts, 'done' => 0, 'skipped' => 0, 'errors' => []];
		}
		$sh = $action === 'copy' ? $this->shellOf($session) : null;
		$done = 0;
		$skipped = 0;
		$errors = [];
		foreach ($plan as [$src, $target, $isDir, $there, $same]) {
			try {
				if ($there !== null) {
					if ($same || $onExists === 'rename') {
						$target = $this->uniqueRemote($session, $this->dirOf($target), basename($target));
						$there = null;
					} elseif ($onExists === 'skip') {
						$skipped++;
						continue;
					} elseif (!empty($there['directory']) !== $isDir) {
						throw new \RuntimeException($this->l->t('%s: a file and a folder cannot replace each other.', [basename($target)]));
					} elseif ($isDir && $action === 'move') {
						throw new \RuntimeException($this->l->t('%s: a folder of that name is already there. Choose a new name, or skip it.', [basename($target)]));
					}
				}
				$emit(['stage' => 'progress', 'name' => basename($src), 'done' => $done, 'total' => count($plan)]);
				if ($action === 'move') {
					if ($there !== null && !$this->removeRemoteFile($session, $target)) {
						throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['delete', $target]));
					}
					if (!$this->renameRemote($session, $src, $target)) {
						throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['move', $src]));
					}
				} else {
					$this->copyRemote($session, $sh, $src, $target, $isDir, $there !== null, $emit);
				}
				$done++;
			} catch (\RuntimeException $e) {
				$errors[] = $this->l->said($e);
			}
			unset($this->listed[$this->dirOf($target)], $this->listed[$this->dirOf($src)]);
		}
		return ['done' => $done, 'skipped' => $skipped, 'errors' => $errors];
	}

	private function copyRemote(array $session, ?\Closure $sh, string $src, string $target, bool $isDir, bool $merge, callable $emit): void {
		if ($sh !== null) {
			// Into an existing folder of the same name, the contents are merged —
			// what every file manager does — rather than nesting a second copy inside it.
			$from = $isDir && $merge ? $src . '/.' : $src;
			[$ok, $out] = $this->longRun($session, $sh, 'cp -a -f -- ' . escapeshellarg($from) . ' ' . escapeshellarg($target), $emit, basename($src));
			if (!$ok) {
				throw new \RuntimeException($out !== '' ? $out : $this->l->t('The server refused: %1$s %2$s', ['copy', $src]));
			}
			return;
		}
		if (!$isDir) {
			$this->copyThroughHere($session, $src, $target);
			return;
		}
		$count = 0;
		$this->copyFolderThroughHere($session, $src, $target, 0, $count, $emit);
	}

	private function copyThroughHere(array $session, string $src, string $target): void {
		$tmp = tempnam(sys_get_temp_dir(), 'netbase-scp-');
		if ($tmp === false) {
			throw new \RuntimeException('No temporary file could be made on this server');
		}
		try {
			if (!$this->fetchTo($session, $src, $tmp) || !$this->sendFrom($session, $tmp, $target)) {
				throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['copy', $src]));
			}
		} finally {
			@unlink($tmp);
		}
	}

	private function copyFolderThroughHere(array $session, string $src, string $target, int $depth, int &$count, callable $emit): void {
		if ($depth > self::ZIP_DEPTH) {
			throw new \RuntimeException($this->l->t('%s is nested too deeply to copy.', [$src]));
		}
		if ($this->entryOf($session, $target) === null && !$this->makeRemoteDir($session, $target)) {
			throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['mkdir', $target]));
		}
		foreach ($this->readDir($session, $src) as $e) {
			$name = (string)($e['name'] ?? '');
			if ($name === '' || $name === '.' || $name === '..' || !empty($e['link']) || !empty($e['raw'])) {
				continue;
			}
			if (!empty($e['directory'])) {
				$this->copyFolderThroughHere($session, $src . '/' . $name, $target . '/' . $name, $depth + 1, $count, $emit);
				continue;
			}
			$this->copyThroughHere($session, $src . '/' . $name, $target . '/' . $name);
			$count++;
			$emit(['stage' => 'progress', 'name' => $name, 'files' => $count]);
		}
	}

	/**
	 * Compress into one ZIP or tar.gz file, kept on the server or in the
	 * reader's Nextcloud files — the reader is asked which.
	 *
	 * Where the server can run commands, it does the work itself (tar, zip):
	 * nothing crosses the network twice, and there are no size limits but its
	 * own disk. Where it cannot, or has no zip, a ZIP is built here instead,
	 * within the same limits as downloading a folder. A tar.gz needs the shell.
	 *
	 * @return array<string, mixed>
	 */
	private function compress(array $session, string $userId, array $paths, array $op, callable $emit): array {
		if ($paths === []) {
			throw new \InvalidArgumentException('Choose what to compress');
		}
		$parent = $this->dirOf($paths[0]);
		foreach ($paths as $p) {
			if ($this->dirOf($p) !== $parent) {
				throw new \InvalidArgumentException('Everything to compress has to be in the same folder');
			}
		}
		$format = (string)($op['format'] ?? 'zip');
		if (!isset(ArchiveFormats::FORMATS[$format]) || $format === 'rar') {
			throw new \InvalidArgumentException('Unknown format');
		}
		$spec = ArchiveFormats::FORMATS[$format];
		$ext = $spec['ext'];
		if ($spec['single']) {
			$only = count($paths) === 1 ? $this->entryOf($session, $paths[0]) : null;
			if (count($paths) !== 1 || ($only !== null && !empty($only['directory']))) {
				throw new \RuntimeException($this->l->t('%s compresses one file at a time. Choose a single file, or an archive format such as ZIP or tar.gz.', [$ext]));
			}
		}
		$name = trim(str_replace(['/', '\\', "\0", "\r", "\n"], '_', (string)($op['name'] ?? '')));
		if ($name === '') {
			$name = count($paths) === 1 ? basename($paths[0]) : 'archive';
		}
		if (!str_ends_with(strtolower($name), $ext)) {
			$name .= $ext;
		}
		$where = ($op['where'] ?? 'server') === 'nextcloud' ? 'nextcloud' : 'server';
		$onExists = (string)($op['onExists'] ?? 'ask');
		$folder = null;
		$target = '';
		$overwrite = false;
		if ($where === 'nextcloud') {
			$folder = $this->userFolder($userId, (string)($op['dest'] ?? 'NetBase'));
			if ($folder->nodeExists($name)) {
				if ($onExists === 'ask') {
					return ['conflicts' => [['name' => $name, 'path' => $name, 'directory' => $folder->get($name) instanceof Folder]]];
				}
				if ($onExists === 'skip') {
					return ['done' => 0, 'skipped' => 1, 'errors' => []];
				}
				if ($onExists === 'rename' || $folder->get($name) instanceof Folder) {
					$name = $this->uniqueName($folder, $name);
				} else {
					$overwrite = true;
				}
			}
		} else {
			$target = $this->joinRemote($this->cleanPath((string)($op['dest'] ?? $parent)), $name);
			$there = $this->entryOf($session, $target);
			if ($there !== null) {
				if ($onExists === 'ask') {
					return ['conflicts' => [['name' => $name, 'path' => $target, 'directory' => !empty($there['directory']), 'size' => $there['size'] ?? null, 'modified' => $there['modified'] ?? null]]];
				}
				if ($onExists === 'skip') {
					return ['done' => 0, 'skipped' => 1, 'errors' => []];
				}
				if ($onExists === 'rename' || !empty($there['directory'])) {
					$target = $this->uniqueRemote($session, $this->dirOf($target), $name);
				} elseif (!$this->removeRemoteFile($session, $target)) {
					// zip adds to an archive that is already there instead of replacing it.
					throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['delete', $target]));
				}
			}
		}
		$emit(['stage' => 'progress', 'name' => $where === 'nextcloud' ? $name : basename($target)]);
		$names = array_map('basename', $paths);
		$sh = $this->shellOf($session);
		$tools = $this->toolsOf($session);
		$command = $tools === null ? null : ArchiveFormats::makeCommand($format, $names, $tools);
		if ($sh !== null && $command !== null) {
			$dir = $parent === '' ? '.' : ($parent[0] === '-' ? './' . $parent : $parent);
			$make = static fn (string $out): string => 'o=' . escapeshellarg($out) . '; case "$o" in /*) ;; *) o="$PWD/$o" ;; esac; cd ' . escapeshellarg($dir) . ' && ' . $command;
			if ($where === 'server') {
				[$ok, $out] = $this->longRun($session, $sh, $make($target), $emit, basename($target));
				if (!$ok) {
					throw new \RuntimeException($out !== '' ? $out : $this->l->t('The server refused: %1$s %2$s', ['compress', $target]));
				}
				return ['done' => 1, 'skipped' => 0, 'errors' => [], 'where' => 'server', 'path' => $target, 'name' => basename($target)];
			}
			$stage = $this->remoteStage($session);
			try {
				$made = $stage . '/' . bin2hex(random_bytes(8)) . $ext;
				[$ok, $out] = $this->longRun($session, $sh, $make($made) . ' && chmod 0644 ' . escapeshellarg($made), $emit, $name);
				if (!$ok) {
					throw new \RuntimeException($out !== '' ? $out : $this->l->t('The server refused: %1$s %2$s', ['compress', $name]));
				}
				$tmp = tempnam(sys_get_temp_dir(), 'netbase-zip-');
				try {
					if ($tmp === false || !$this->fetchTo($session, $made, $tmp, true)) {
						throw new \RuntimeException($this->l->t('Could not read %s', [$name]));
					}
					$this->storeInNextcloud($folder, $name, $tmp, $overwrite);
				} finally {
					if ($tmp !== false) {
						@unlink($tmp);
					}
				}
			} finally {
				$this->remoteUnstage($session, $stage);
			}
			return ['done' => 1, 'skipped' => 0, 'errors' => [], 'where' => 'nextcloud', 'path' => $folder->getPath() . '/' . $name, 'name' => $name];
		}
		// No shell there, or none of the tools: made on this server, from the
		// files brought here one by one. ZIP, tar, tar.gz and tar.bz2 can be.
		if (!in_array($format, ArchiveFormats::phpCan()['make'], true)) {
			throw new \RuntimeException($this->l->t('%s files cannot be made for this server: the tools for it are not there, and NetBase cannot make them itself.', [$ext]));
		}
		$work = $this->scratchDir();
		try {
			$built = $this->buildHere($session, $paths, $format, $work);
			if ($where === 'server') {
				if (!$this->sendFrom($session, $built, $target)) {
					throw new \RuntimeException($this->l->t('The server refused the upload'));
				}
				return ['done' => 1, 'skipped' => 0, 'errors' => [], 'where' => 'server', 'path' => $target, 'name' => basename($target)];
			}
			$this->storeInNextcloud($folder, $name, $built, $overwrite);
			return ['done' => 1, 'skipped' => 0, 'errors' => [], 'where' => 'nextcloud', 'path' => $folder->getPath() . '/' . $name, 'name' => $name];
		} finally {
			$this->dropScratch($work);
		}
	}

	/**
	 * An archive made on this server from files read off the far end: ZIP by
	 * ZipArchive, tar and its compressed forms by PharData. The limits are the
	 * download-as-ZIP ones, and an archive that would leave something out is
	 * refused rather than made short.
	 *
	 * @return string the local file
	 */
	private function buildHere(array $session, array $paths, string $format, string $work): string {
		if ($format === 'zip') {
			$file = $work . '/archive.zip';
			$box = new \ZipArchive();
			if ($box->open($file, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
				throw new \RuntimeException('The ZIP file could not be started');
			}
		} else {
			$file = $work . '/archive.tar';
			$box = new \PharData($file);
		}
		$count = 0;
		$bytes = 0;
		$truncated = false;
		foreach ($paths as $p) {
			$entry = $this->entryOf($session, $p);
			if ($entry !== null && !empty($entry['directory'])) {
				$this->addFolderToZip($session, $box, $p, '', 0, $count, $bytes, $truncated);
			} else {
				$data = $this->readWholeFile($session, $p);
				if ($data === null) {
					throw new \RuntimeException($this->l->t('Could not read %s', [$p]));
				}
				$box->addFromString(basename($p), $data);
				$count++;
				$bytes += strlen($data);
			}
			if ($truncated) {
				throw new \RuntimeException($this->l->t('This is too large to compress here (at most %1$s files and %2$s). Compress it on the server instead, over SSH.', [(string)self::ZIP_FILES, $this->readableSize(self::ZIP_BYTES)]));
			}
		}
		if ($box instanceof \ZipArchive) {
			if (!$box->close()) {
				throw new \RuntimeException('The ZIP file could not be finished');
			}
			return $file;
		}
		if ($format === 'tar') {
			unset($box);
			return $file;
		}
		$box->compress($format === 'tgz' ? \Phar::GZ : \Phar::BZ2);
		unset($box);
		return $work . '/archive' . ArchiveFormats::FORMATS[$format]['ext'];
	}

	/**
	 * The archive and compression tools the far end has, asked once a
	 * session, or null when there is no shell there to run them.
	 *
	 * @return list<string>|null
	 */
	private function toolsOf(array $session): ?array {
		$h = $session['handle'];
		$key = is_object($h) ? spl_object_id($h) : 0;
		if (array_key_exists($key, $this->archTools)) {
			return $this->archTools[$key];
		}
		$sh = $this->shellOf($session);
		if ($sh === null) {
			return $this->archTools[$key] = null;
		}
		[, $out] = $sh(ArchiveFormats::probeCommand());
		return $this->archTools[$key] = ArchiveFormats::parseProbe($out);
	}

	/** What can be made and opened here, for the compress and extract dialogs. */
	private function archivers(array $session): array {
		$tools = $this->toolsOf($session);
		return ['shell' => $tools !== null, 'tools' => $tools ?? [], 'formats' => ArchiveFormats::availability($tools)];
	}

	/**
	 * Open an archive on the far end.
	 *
	 * By default it goes into a new folder named after it, beside it, so
	 * nothing already there can be overwritten. "Here" puts its contents into
	 * the chosen folder itself; it is opened into a scratch folder first and
	 * merged from there, keeping what is already there unless overwriting was
	 * chosen. The one-file formats (.gz and its kin) give one file, its name
	 * without the extension.
	 *
	 * @return array<string, mixed>
	 */
	private function extract(array $session, array $paths, array $op, callable $emit): array {
		if (count($paths) !== 1) {
			throw new \InvalidArgumentException('Choose one archive to open');
		}
		$archive = $paths[0];
		$name = basename($archive);
		$format = ArchiveFormats::detect($name);
		if ($format === null) {
			throw new \RuntimeException($this->l->t('%s is not an archive NetBase knows.', [$name]));
		}
		$spec = ArchiveFormats::FORMATS[$format];
		$destDir = array_key_exists('dest', $op) && trim((string)$op['dest']) !== '' ? $this->cleanPath((string)$op['dest']) : $this->dirOf($archive);
		$into = ($op['into'] ?? 'folder') === 'here' ? 'here' : 'folder';
		$onExists = (string)($op['onExists'] ?? 'skip');
		$stem = ArchiveFormats::stem($name);
		$sh = $this->shellOf($session);
		$tools = $this->toolsOf($session);
		$emit(['stage' => 'progress', 'name' => $name]);

		if ($spec['single']) {
			$target = $this->joinRemote($destDir, $stem);
			$there = $this->entryOf($session, $target);
			if ($there !== null) {
				if ($onExists === 'ask') {
					return ['conflicts' => [['name' => $stem, 'path' => $target, 'directory' => !empty($there['directory']), 'size' => $there['size'] ?? null, 'modified' => $there['modified'] ?? null]]];
				}
				if ($onExists === 'skip') {
					return ['done' => 0, 'skipped' => 1, 'errors' => []];
				}
				if ($onExists === 'rename' || !empty($there['directory'])) {
					$target = $this->uniqueRemote($session, $destDir, $stem);
				}
			}
			$command = $tools === null ? null : ArchiveFormats::openCommand($format, $archive, $target, $tools);
			if ($sh !== null && $command !== null) {
				[$ok, $out] = $this->longRun($session, $sh, $command, $emit, $name);
				if (!$ok) {
					throw new \RuntimeException($out !== '' ? $out : $this->l->t('The server refused: %1$s %2$s', ['extract', $name]));
				}
				return ['done' => 1, 'skipped' => 0, 'errors' => [], 'path' => $target, 'name' => basename($target)];
			}
			if (!in_array($format, ArchiveFormats::phpCan()['open'], true)) {
				throw new \RuntimeException($this->l->t('%s files cannot be opened on this server: the tools for it are not there, and NetBase cannot open them itself.', [$spec['ext']]));
			}
			$work = $this->scratchDir();
			try {
				$packed = $work . '/in' . $spec['ext'];
				if (!$this->fetchTo($session, $archive, $packed)) {
					throw new \RuntimeException($this->l->t('Could not read %s', [$name]));
				}
				$plain = $work . '/out';
				if (!@copy(($format === 'gz' ? 'compress.zlib://' : 'compress.bzip2://') . $packed, $plain)) {
					throw new \RuntimeException($this->l->t('%s could not be opened: it is damaged, or not what its name says.', [$name]));
				}
				if (!$this->sendFrom($session, $plain, $target)) {
					throw new \RuntimeException($this->l->t('The server refused the upload'));
				}
			} finally {
				$this->dropScratch($work);
			}
			return ['done' => 1, 'skipped' => 0, 'errors' => [], 'path' => $target, 'name' => basename($target)];
		}

		$folder = $destDir;
		if ($into === 'folder') {
			$folder = $this->joinRemote($destDir, $stem);
			if ($this->entryOf($session, $folder) !== null) {
				$folder = $this->uniqueRemote($session, $destDir, $stem);
			}
		}
		$probe = $tools === null ? null : ArchiveFormats::openCommand($format, $archive, '/x', $tools);
		if ($sh !== null && $probe !== null) {
			$scratch = $into === 'folder' ? $folder : $this->joinRemote($destDir, '.netbase-extract-' . bin2hex(random_bytes(5)));
			if (!$this->makeRemoteDir($session, $scratch)) {
				throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['mkdir', $scratch]));
			}
			$keep = false;
			try {
				[$ok, $out] = $this->longRun($session, $sh, (string)ArchiveFormats::openCommand($format, $archive, $scratch, $tools), $emit, $name);
				if (!$ok) {
					throw new \RuntimeException($out !== '' ? $out : $this->l->t('The server refused: %1$s %2$s', ['extract', $name]));
				}
				[, $n] = $sh('find ' . escapeshellarg($scratch) . ' -mindepth 1 | wc -l');
				if ($into === 'folder') {
					$keep = true;
					return ['done' => (int)trim($n), 'skipped' => 0, 'errors' => [], 'path' => $folder, 'name' => basename($folder)];
				}
				$to = ($destDir === '' ? '.' : $destDir) . '/';
				[$ok, $out] = $sh('cp -a' . ($onExists === 'overwrite' ? '' : 'n') . ' ' . escapeshellarg($scratch . '/.') . ' ' . escapeshellarg($to));
				if (!$ok) {
					throw new \RuntimeException($out !== '' ? $out : $this->l->t('The server refused: %1$s %2$s', ['extract', $name]));
				}
				return ['done' => (int)trim($n), 'skipped' => 0, 'errors' => [], 'path' => $destDir, 'name' => basename($destDir)];
			} finally {
				if (!$keep) {
					// Only the folder made for this, a moment ago, is removed.
					$sh('rm -rf -- ' . escapeshellarg($scratch));
				}
			}
		}
		if (!in_array($format, ArchiveFormats::phpCan()['open'], true)) {
			throw new \RuntimeException($this->l->t('%s files cannot be opened on this server: the tools for it are not there, and NetBase cannot open them itself.', [$spec['ext']]));
		}
		$work = $this->scratchDir();
		try {
			$packed = $work . '/in' . $spec['ext'];
			if (!$this->fetchTo($session, $archive, $packed)) {
				throw new \RuntimeException($this->l->t('Could not read %s', [$name]));
			}
			if (filesize($packed) > self::ZIP_BYTES) {
				throw new \RuntimeException($this->l->t('This is too large to open here (at most %1$s files and %2$s). Open it on the server instead, over SSH.', [(string)self::ZIP_FILES, $this->readableSize(self::ZIP_BYTES)]));
			}
			mkdir($work . '/x', 0700);
			$this->extractHere($packed, $format, $work . '/x');
			if ($into === 'folder' && !$this->makeRemoteDir($session, $folder)) {
				throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['mkdir', $folder]));
			}
			$sent = 0;
			$skipped = 0;
			$this->sendTree($session, $work . '/x', $folder, $into === 'folder' || $onExists === 'overwrite', $sent, $skipped);
			return ['done' => $sent, 'skipped' => $skipped, 'errors' => [], 'path' => $folder, 'name' => basename($folder)];
		} finally {
			$this->dropScratch($work);
		}
	}

	/**
	 * Open an archive here, into a local folder, by ZipArchive or PharData.
	 *
	 * Every name is checked before anything is written: one that climbs out
	 * ("../x"), starts at the root, or is a link is left out, so an archive
	 * cannot place a file anywhere but inside the folder it is opened into.
	 */
	private function extractHere(string $packed, string $format, string $into): void {
		$count = 0;
		$bytes = 0;
		$room = function (int $more) use (&$count, &$bytes): void {
			$count++;
			$bytes += $more;
			if ($count > self::ZIP_FILES || $bytes > self::ZIP_BYTES) {
				throw new \RuntimeException($this->l->t('This is too large to open here (at most %1$s files and %2$s). Open it on the server instead, over SSH.', [(string)self::ZIP_FILES, $this->readableSize(self::ZIP_BYTES)]));
			}
		};
		if ($format === 'zip') {
			$zip = new \ZipArchive();
			if ($zip->open($packed) !== true) {
				throw new \RuntimeException($this->l->t('%s could not be opened: it is damaged, or not what its name says.', ['ZIP']));
			}
			try {
				for ($i = 0; $i < $zip->numFiles; $i++) {
					$stat = $zip->statIndex($i);
					$raw = (string)($stat['name'] ?? '');
					$rel = self::safeEntryName($raw);
					$opsys = 0;
					$attr = 0;
					$zip->getExternalAttributesIndex($i, $opsys, $attr);
					if ($rel === null || ($opsys === \ZipArchive::OPSYS_UNIX && (($attr >> 16) & 0170000) === 0120000)) {
						continue;
					}
					if (str_ends_with($raw, '/')) {
						@mkdir($into . '/' . $rel, 0700, true);
						continue;
					}
					$room((int)($stat['size'] ?? 0));
					@mkdir(dirname($into . '/' . $rel), 0700, true);
					$in = $zip->getStream($raw);
					$out = @fopen($into . '/' . $rel, 'wb');
					if (!is_resource($in) || !is_resource($out)) {
						throw new \RuntimeException('Could not open part of the archive');
					}
					stream_copy_to_stream($in, $out);
					fclose($in);
					fclose($out);
				}
			} finally {
				$zip->close();
			}
			return;
		}
		$this->untar($packed, $format, $into, $room);
	}

	/**
	 * Read a tar archive (plain, gzip or bzip2) into a local folder.
	 *
	 * Written here rather than left to PharData, which lists nothing in the
	 * archives GNU tar makes with "./" names, and which would decide for itself
	 * what to do with links. Only plain files and folders are written; links,
	 * devices and names that would climb out are passed over. Long names (GNU
	 * and pax) are understood. A header whose checksum is wrong stops it: the
	 * file is damaged, or not a tar archive at all.
	 */
	private function untar(string $packed, string $format, string $into, callable $room): void {
		$wrapper = ['tgz' => 'compress.zlib://', 'tbz2' => 'compress.bzip2://'][$format] ?? '';
		$in = @fopen($wrapper . $packed, 'rb');
		if (!is_resource($in)) {
			throw new \RuntimeException($this->l->t('%s could not be opened: it is damaged, or not what its name says.', [basename($packed)]));
		}
		$damaged = fn (): \RuntimeException => new \RuntimeException($this->l->t('%s could not be opened: it is damaged, or not what its name says.', ['tar']));
		$read = static function ($in, int $n): string {
			$out = '';
			while (strlen($out) < $n && !feof($in)) {
				$chunk = fread($in, min(262144, $n - strlen($out)));
				if ($chunk === false || $chunk === '') {
					break;
				}
				$out .= $chunk;
			}
			return $out;
		};
		$skip = static function ($in, int $n) use ($read): void {
			while ($n > 0) {
				$got = strlen($read($in, min($n, 262144)));
				if ($got === 0) {
					return;
				}
				$n -= $got;
			}
		};
		$long = null;
		try {
			while (true) {
				$h = $read($in, 512);
				if (strlen($h) < 512 || trim($h, "\0") === '') {
					break;
				}
				$sum = 0;
				for ($i = 0; $i < 512; $i++) {
					$sum += ($i >= 148 && $i < 156) ? 32 : ord($h[$i]);
				}
				if ($sum !== (int)octdec(trim(substr($h, 148, 8), "\0 "))) {
					throw $damaged();
				}
				if ((ord($h[124]) & 0x80) !== 0) {
					$size = 0;
					for ($i = 125; $i < 136; $i++) {
						$size = $size * 256 + ord($h[$i]);
					}
				} else {
					$size = (int)octdec(trim(substr($h, 124, 12), "\0 "));
				}
				$pad = (512 - $size % 512) % 512;
				$type = $h[156];
				$name = rtrim(substr($h, 0, 100), "\0");
				$prefix = rtrim(substr($h, 345, 155), "\0");
				if (str_starts_with(substr($h, 257, 6), 'ustar') && $prefix !== '') {
					$name = $prefix . '/' . $name;
				}
				if ($type === 'L' || $type === 'x') {
					// The next entry's real name: a GNU long name, or a pax "path=" record.
					$data = $read($in, $size);
					$skip($in, $pad);
					if ($type === 'L') {
						$long = rtrim($data, "\0");
					} elseif (preg_match('/(?:^|\n)\d+ path=([^\n]*)\n/', $data, $m)) {
						$long = $m[1];
					}
					continue;
				}
				if ($long !== null) {
					$name = $long;
					$long = null;
				}
				$rel = self::safeEntryName($name);
				if ($type === '5') {
					if ($rel !== null) {
						@mkdir($into . '/' . $rel, 0700, true);
					}
					$skip($in, $size + $pad);
					continue;
				}
				if ($rel === null || !in_array($type, ['0', "\0", '7'], true)) {
					$skip($in, $size + $pad);
					continue;
				}
				$room($size);
				@mkdir(dirname($into . '/' . $rel), 0700, true);
				$out = @fopen($into . '/' . $rel, 'wb');
				if (!is_resource($out)) {
					throw new \RuntimeException('Could not open part of the archive');
				}
				$copied = stream_copy_to_stream($in, $out, $size);
				fclose($out);
				if ($copied !== $size) {
					throw $damaged();
				}
				$skip($in, $pad);
			}
		} finally {
			fclose($in);
		}
	}

	/** A name inside an archive as a safe relative path, or null if it is not one. */
	public static function safeEntryName(string $name): ?string {
		if ($name === '' || str_contains($name, "\0")) {
			return null;
		}
		$parts = [];
		foreach (explode('/', str_replace('\\', '/', $name)) as $part) {
			if ($part === '' || $part === '.') {
				continue;
			}
			if ($part === '..' || preg_match('/^[A-Za-z]:$/', $part)) {
				return null;
			}
			$parts[] = $part;
		}
		return $parts === [] ? null : implode('/', $parts);
	}

	/** A local folder's files up to the far end, keeping or replacing what is there. */
	private function sendTree(array $session, string $local, string $remote, bool $replace, int &$sent, int &$skipped): void {
		foreach (scandir($local) ?: [] as $nm) {
			if ($nm === '.' || $nm === '..') {
				continue;
			}
			$here = $local . '/' . $nm;
			$there = $this->joinRemote($remote, $nm);
			$existing = $this->entryOf($session, $there);
			if (is_dir($here)) {
				if ($existing === null && !$this->makeRemoteDir($session, $there)) {
					throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['mkdir', $there]));
				}
				$this->sendTree($session, $here, $there, $replace, $sent, $skipped);
				continue;
			}
			if ($existing !== null && (!$replace || !empty($existing['directory']))) {
				$skipped++;
				continue;
			}
			if (!$this->sendFrom($session, $here, $there)) {
				throw new \RuntimeException($this->l->t('The server refused the upload'));
			}
			$sent++;
		}
	}

	/** A private folder on this server for the work of one request. */
	private function scratchDir(): string {
		$dir = sys_get_temp_dir() . '/netbase-work-' . bin2hex(random_bytes(8));
		if (!@mkdir($dir, 0700)) {
			throw new \RuntimeException('No temporary folder could be made on this server');
		}
		return $dir;
	}

	private function dropScratch(string $dir): void {
		if (!str_starts_with(basename($dir), 'netbase-work-') || !is_dir($dir)) {
			return;
		}
		$it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST);
		foreach ($it as $f) {
			$f->isDir() && !$f->isLink() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
		}
		@rmdir($dir);
	}

	/**
	 * What text files on the far end are written in: encoding, line endings,
	 * BOM, and their first lines read that way.
	 *
	 * @return array<string, mixed>
	 */
	private function inspectText(array $session, array $paths, array $op): array {
		$from = (string)($op['encFrom'] ?? 'auto');
		$out = [];
		foreach ($paths as $p) {
			$row = ['path' => $p, 'name' => basename($p)];
			$data = $this->textOf($session, $p, $row);
			if ($data !== null) {
				$row += TextConvert::inspect($data, $from);
			}
			$out[] = $row;
		}
		return ['files' => $out];
	}

	/**
	 * Text files on the far end, written again in another encoding, with other
	 * line endings or with the BOM added or taken off.
	 *
	 * Saved beside the original under a name that says what changed, unless
	 * overwriting was chosen. A file that cannot be converted without changing
	 * its text is left alone and named, with the characters, so the reader can
	 * choose to have them replaced.
	 *
	 * @return array<string, mixed>
	 */
	private function convertText(array $session, array $paths, array $op, callable $emit): array {
		$done = 0;
		$same = 0;
		$errors = [];
		$results = [];
		$lost = [];
		foreach ($paths as $p) {
			$emit(['stage' => 'progress', 'name' => basename($p)]);
			$row = [];
			$data = $this->textOf($session, $p, $row);
			if ($data === null) {
				$errors[] = (string)$row['error'];
				continue;
			}
			try {
				$r = TextConvert::convert($data, (string)($op['encFrom'] ?? 'auto'), (string)($op['encTo'] ?? 'keep'), (string)($op['newline'] ?? 'keep'), (string)($op['bom'] ?? 'keep'), !empty($op['allowLoss']));
			} catch (TextConvertException $e) {
				$errors[] = $this->textError($e, basename($p));
				if ($e->reason === 'lost') {
					$lost[] = ['path' => $p, 'name' => basename($p), 'chars' => $e->lost];
				}
				continue;
			}
			if (!$r['changed']) {
				$same++;
				$results[] = ['path' => $p, 'unchanged' => true];
				continue;
			}
			$target = $p;
			if (($op['output'] ?? 'copy') !== 'overwrite') {
				$target = $this->joinRemote($this->dirOf($p), self::convertedName(basename($p), $op));
				if ($this->entryOf($session, $target) !== null) {
					$target = $this->uniqueRemote($session, $this->dirOf($p), basename($target));
				}
			}
			$tmp = tempnam(sys_get_temp_dir(), 'netbase-text-');
			try {
				if ($tmp === false || file_put_contents($tmp, $r['bytes']) === false || !$this->sendFrom($session, $tmp, $target)) {
					$errors[] = $this->l->t('The server refused: %1$s %2$s', ['write', $target]);
					continue;
				}
			} finally {
				if ($tmp !== false) {
					@unlink($tmp);
				}
			}
			$done++;
			$results[] = ['path' => $p, 'saved' => $target, 'from' => $r['from'], 'to' => $r['to'], 'newline' => $r['newline'], 'bom' => $r['bom'], 'replaced' => $r['lost']];
		}
		return ['done' => $done, 'skipped' => $same, 'errors' => $errors, 'results' => $results, 'lost' => $lost];
	}

	/** A file's bytes for converting, or null with the reason put in $row['error']. */
	private function textOf(array $session, string $p, array &$row): ?string {
		$e = $this->entryOf($session, $p);
		if ($e === null) {
			$row['error'] = $this->l->t('%s is no longer there.', [basename($p)]);
		} elseif (!empty($e['directory'])) {
			$row['error'] = $this->l->t('%s is a folder; choose the files in it.', [basename($p)]);
		} elseif ((int)($e['size'] ?? 0) > TextConvert::MAX_BYTES) {
			$row['error'] = $this->l->t('%1$s is larger than %2$s, too large to convert here.', [basename($p), $this->readableSize(TextConvert::MAX_BYTES)]);
		} else {
			$data = $this->readWholeFile($session, $p);
			if ($data !== null) {
				return $data;
			}
			$row['error'] = $this->l->t('Could not read %s', [basename($p)]);
		}
		return null;
	}

	/** The reason a conversion was not done, in words. */
	private function textError(TextConvertException $e, string $name): string {
		return match ($e->reason) {
			'binary' => $this->l->t('%s does not look like a text file, so it was left as it is.', [$name]),
			'too-large' => $this->l->t('%1$s is larger than %2$s, too large to convert here.', [$name, $this->readableSize(TextConvert::MAX_BYTES)]),
			'not-valid' => $this->l->t('%1$s is not written in %2$s. Choose the encoding it is really in, or let NetBase work it out.', [$name, $e->args[0] ?? '']),
			'lost' => $this->l->t('%1$s: %2$s has no place for %3$s. Nothing was changed.', [$name, $e->args[0] ?? '', implode(' ', $e->lost)]),
			default => $name,
		};
	}

	/** "notes.txt" saved as UTF-8 with CRLF becomes "notes (UTF-8 CRLF).txt". */
	public static function convertedName(string $name, array $op): string {
		$parts = [];
		if (($op['encTo'] ?? 'keep') !== 'keep') {
			$parts[] = (string)$op['encTo'];
		}
		if (($op['newline'] ?? 'keep') !== 'keep') {
			$parts[] = strtoupper((string)$op['newline']);
		}
		if (($op['bom'] ?? 'keep') === 'add') {
			$parts[] = 'BOM';
		} elseif (($op['bom'] ?? 'keep') === 'remove') {
			$parts[] = 'no BOM';
		}
		$label = $parts === [] ? 'converted' : implode(' ', $parts);
		$dot = strrpos($name, '.');
		return $dot !== false && $dot > 0 ? substr($name, 0, $dot) . ' (' . $label . ')' . substr($name, $dot) : $name . ' (' . $label . ')';
	}

	/**
	 * Permissions, on one entry or everything under it.
	 *
	 * Going down into a folder is a choice, and so is what it applies to there —
	 * files, folders, or both — as in any FTP client: 0644 for files and 0755
	 * for folders is the usual pair, and one number for both would make every
	 * file executable or every folder unopenable.
	 *
	 * @return array<string, mixed>
	 */
	private function chmodAll(array $session, array $paths, string $mode, string $recurse, callable $emit): array {
		$mode = trim($mode);
		if (!preg_match('/^[0-7]{3,4}$/', $mode)) {
			throw new \InvalidArgumentException($this->l->t('That is not a permission number.'));
		}
		if (!in_array($recurse, ['', 'all', 'files', 'dirs'], true)) {
			$recurse = '';
		}
		$bits = (int)octdec($mode);
		$sh = $recurse !== '' ? $this->shellOf($session) : null;
		$done = 0;
		$errors = [];
		foreach ($paths as $p) {
			try {
				if ($recurse === '') {
					$ok = $this->chmodOne($session, $p, $bits);
				} elseif ($sh !== null) {
					$start = escapeshellarg($p[0] === '/' ? $p : './' . $p);
					[$ok, $out] = $this->longRun($session, $sh, match ($recurse) {
						'files' => 'find ' . $start . ' -type f -exec chmod ' . $mode . ' {} +',
						'dirs' => 'find ' . $start . ' -type d -exec chmod ' . $mode . ' {} +',
						default => 'chmod -R ' . $mode . ' ' . $start,
					}, $emit, basename($p));
					if (!$ok && $out !== '') {
						throw new \RuntimeException($out);
					}
				} else {
					$count = 0;
					$ok = $this->chmodWalk($session, $p, $bits, $recurse, 0, $count);
				}
				if (!$ok) {
					throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['chmod', $p]));
				}
				$done++;
			} catch (\RuntimeException $e) {
				$errors[] = $this->l->said($e);
			}
		}
		return ['done' => $done, 'skipped' => 0, 'errors' => $errors];
	}

	private function chmodOne(array $session, string $path, int $bits): bool {
		return $session['kind'] === 'ftp'
			? @ftp_chmod($session['handle'], $bits, $path) !== false
			: (bool)@$session['handle']->chmod($bits, $path);
	}

	private function chmodWalk(array $session, string $path, int $bits, string $recurse, int $depth, int &$count): bool {
		$entry = $this->entryOf($session, $path);
		if ($entry === null || $depth > self::ZIP_DEPTH || $count > self::ZIP_FILES * 10) {
			return $entry !== null;
		}
		$isDir = !empty($entry['directory']);
		$ok = true;
		if ($recurse === 'all' || ($recurse === 'files' && !$isDir) || ($recurse === 'dirs' && $isDir)) {
			$ok = $this->chmodOne($session, $path, $bits);
			$count++;
		}
		if ($isDir) {
			$this->listed[$path] = $this->readDir($session, $path);
			foreach ($this->listed[$path] as $e) {
				$name = (string)($e['name'] ?? '');
				if ($name === '' || $name === '.' || $name === '..' || !empty($e['link'])) {
					continue;
				}
				$ok = $this->chmodWalk($session, $path . '/' . $name, $bits, $recurse, $depth + 1, $count) && $ok;
			}
		}
		return $ok;
	}

	/** An empty file, refusing a name that is taken rather than emptying what is there. */
	private function newEmptyFile(array $session, string $path): array {
		if ($path === '') {
			throw new \InvalidArgumentException('Choose a name');
		}
		if ($this->entryOf($session, $path) !== null) {
			throw new \RuntimeException($this->l->t('%s is already there.', [basename($path)]));
		}
		$tmp = tempnam(sys_get_temp_dir(), 'netbase-scp-');
		if ($tmp === false) {
			throw new \RuntimeException('No temporary file could be made on this server');
		}
		try {
			if (!$this->sendFrom($session, $tmp, $path)) {
				throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['create', $path]));
			}
		} finally {
			@unlink($tmp);
		}
		return ['done' => 1, 'skipped' => 0, 'errors' => [], 'path' => $path];
	}

	/**
	 * Names matching a pattern, in a folder and everything under it.
	 *
	 * The pattern is the usual wildcard one (*.conf, backup-??.tar); plain text
	 * finds names that contain it. Letter case is ignored. find does the work
	 * where there is a shell; elsewhere the folders are walked from here, with
	 * a limit on how many it reads.
	 *
	 * @return array<string, mixed>
	 */
	private function search(array $session, string $path, string $pattern, callable $emit): array {
		$pattern = trim(str_replace(["\0", "\r", "\n", '/'], '', $pattern));
		if ($pattern === '') {
			throw new \InvalidArgumentException($this->l->t('Enter what to look for.'));
		}
		if (strpbrk($pattern, '*?[') === false) {
			$pattern = '*' . $pattern . '*';
		}
		$path = $this->cleanPath($path);
		$limit = 500;
		$found = [];
		$more = false;
		$sh = $this->shellOf($session);
		if ($sh !== null) {
			$start = escapeshellarg($path === '' ? '.' : ($path[0] === '/' ? $path : './' . $path));
			[, $out] = $this->longRun($session, $sh, 'find ' . $start
				. ' -iname ' . escapeshellarg($pattern)
				. ' \( -type d -exec printf "d\t%s\n" {} + -o -exec printf "f\t%s\n" {} + \) 2>/dev/null | head -n ' . ($limit + 1), $emit, $pattern);
			foreach (explode("\n", $out) as $line) {
				if (!preg_match('/^([df])\t(.+)$/', $line, $m)) {
					continue;
				}
				if (count($found) >= $limit) {
					$more = true;
					break;
				}
				$found[] = ['path' => $m[2], 'directory' => $m[1] === 'd'];
			}
			return ['results' => $found, 'more' => $more];
		}
		$queue = [[$path, 0]];
		$read = 0;
		$until = microtime(true) + 60;
		while ($queue !== []) {
			[$dir, $depth] = array_shift($queue);
			try {
				$entries = $this->readDir($session, $dir);
			} catch (\Throwable $e) {
				continue;
			}
			foreach ($entries as $e) {
				$name = (string)($e['name'] ?? '');
				if ($name === '' || $name === '.' || $name === '..') {
					continue;
				}
				$full = $this->joinRemote($dir, $name);
				if (fnmatch($pattern, $name, FNM_CASEFOLD)) {
					if (count($found) >= $limit) {
						return ['results' => $found, 'more' => true];
					}
					$found[] = ['path' => $full, 'directory' => !empty($e['directory'])];
				}
				if (!empty($e['directory']) && empty($e['link']) && $depth < self::ZIP_DEPTH) {
					$queue[] = [$full, $depth + 1];
				}
			}
			if (++$read > 2000 || microtime(true) > $until) {
				$more = $queue !== [];
				break;
			}
		}
		return ['results' => $found, 'more' => $more];
	}

	/**
	 * How fast files move to and from a saved connection.
	 *
	 * Random bytes — so that compression on the way cannot flatter the result —
	 * are sent to a file on the server, fetched back, compared with what was
	 * sent, and the file is removed. Signing in is timed on its own: over a
	 * slow link it is most of what a small transfer costs, and it is not the
	 * line's speed.
	 *
	 * Nothing is kept on this server, at any size: the bytes are made as they
	 * are sent and checked as they arrive (SpeedStream). The far end does keep
	 * the file while the test runs, so its free space is looked at first where
	 * a shell can say. Stopping — the reader's Stop button closes the request —
	 * breaks the transfer off at the next report, and the file is removed over
	 * a fresh connection, since the interrupted one may no longer answer.
	 *
	 * @param callable(array<string, mixed>): bool $emit
	 */
	public function speedTest(EndpointEntity $endpoint, int $megabytes, string $folder, callable $emit, string $prefer = ''): void {
		$megabytes = max(1, min(self::SPEED_MAX_MB, $megabytes));
		$bytes = $megabytes * 1048576;
		$started = microtime(true);
		$session = $this->open($endpoint, '', $prefer);
		$signIn = (int)round((microtime(true) - $started) * 1000);
		$remote = '';
		$ids = [];
		$clean = true;
		try {
			$folder = $this->cleanPath($folder);
			if ($folder === '' && $session['kind'] !== 'ftp') {
				$folder = '/tmp';
			}
			$this->checkRoom($session, $folder, $bytes);
			$remote = $this->joinRemote($folder, '.netbase-speedtest-' . bin2hex(random_bytes(6)) . '.bin');
			$emit(['stage' => 'start', 'signInMs' => $signIn, 'bytes' => $bytes, 'protocol' => $session['kind'], 'path' => $remote]);
			[$source, $ids[]] = SpeedStream::source($bytes);
			$clean = false;
			$up = $this->timedMove($session, 'up', $source, end($ids), $remote, $bytes, $emit);
			[$sink, $ids[]] = SpeedStream::sink();
			$down = $this->timedMove($session, 'down', $sink, end($ids), $remote, $bytes, $emit);
			$clean = true;
			$intact = SpeedStream::position($ids[1]) === $bytes && SpeedStream::digest($ids[0]) === SpeedStream::digest($ids[1]);
			$this->endpoints->touch($endpoint, 'Speed test ' . $megabytes . ' MB');
			$emit([
				'stage' => 'done', 'signInMs' => $signIn, 'bytes' => $bytes, 'protocol' => $session['kind'],
				'path' => $remote, 'up' => $up, 'down' => $down, 'intact' => $intact,
			]);
		} finally {
			foreach ($ids as $id) {
				SpeedStream::forget($id);
			}
			if ($remote !== '') {
				$this->removeTestFile($endpoint, $prefer, $session, $remote, $clean);
			}
			$this->close($session);
		}
	}

	/**
	 * Refuse a test the server has no room for, where a shell can say how much
	 * there is. FTP and SFTP-only accounts cannot be asked; for them a full
	 * disk shows as a failed write, and the partial file is removed as usual.
	 */
	private function checkRoom(array $session, string $folder, int $bytes): void {
		if ($bytes < 104857600) {
			return;
		}
		$sh = $this->shellOf($session);
		if ($sh === null) {
			return;
		}
		[$ok, $out] = $sh('df -Pk ' . escapeshellarg($folder === '' ? '.' : $folder) . ' | tail -n 1');
		$cols = preg_split('/\s+/', trim($out));
		if (!$ok || !is_array($cols) || count($cols) < 4 || !ctype_digit($cols[3])) {
			return;
		}
		$free = (int)$cols[3] * 1024;
		// Leave a little over: a disk filled to the last byte troubles everything else on it.
		if ($free < $bytes + 268435456) {
			throw new \RuntimeException($this->l->t('%1$s has %2$s free, and this test needs %3$s there. Choose a smaller size or another folder.', [
				$folder === '' ? '.' : $folder, $this->readableSize($free), $this->readableSize($bytes),
			]));
		}
	}

	/** Take the test file away, over a fresh connection if the test was broken off. */
	private function removeTestFile(EndpointEntity $endpoint, string $prefer, array $session, string $remote, bool $sessionSound): void {
		if ($sessionSound) {
			try {
				if ($this->removeRemoteFile($session, $remote)) {
					return;
				}
			} catch (\Throwable $e) {
				// fall through to a fresh connection
			}
		}
		try {
			$fresh = $this->open($endpoint, '', $prefer);
			try {
				$this->removeRemoteFile($fresh, $remote);
			} finally {
				$this->close($fresh);
			}
		} catch (\Throwable $e) {
			$this->logger->warning('NetBase: the speed test file ' . $remote . ' could not be removed: ' . $e->getMessage(), ['app' => 'netbase']);
		}
	}

	/**
	 * One direction of the speed test, timed and reported as it goes.
	 *
	 * @param resource $stream the source to send from, or the sink to fetch into
	 * @return array{seconds: float, mbps: float, bytesPerSecond: int}
	 */
	private function timedMove(array $session, string $direction, $stream, string $id, string $remote, int $total, callable $emit): array {
		$t0 = microtime(true);
		$last = 0.0;
		$tick = static function (int $done) use ($emit, $direction, $total, $t0, &$last): void {
			$now = microtime(true);
			if ($now - $last < 0.25) {
				return;
			}
			$last = $now;
			$seconds = max(0.001, $now - $t0);
			if (!$emit(['stage' => 'progress', 'direction' => $direction, 'done' => $done, 'total' => $total, 'seconds' => round($seconds, 1), 'mbps' => round($done * 8 / $seconds / 1e6, 2)])) {
				throw new \RuntimeException('The transfer was stopped');
			}
		};
		$h = $session['handle'];
		$up = $direction === 'up';
		if ($session['kind'] === 'ftp') {
			$state = $up ? @ftp_nb_fput($h, $remote, $stream, FTP_BINARY) : @ftp_nb_fget($h, $stream, $remote, FTP_BINARY);
			while ($state === FTP_MOREDATA) {
				$tick(SpeedStream::position($id));
				$state = @ftp_nb_continue($h);
			}
			$ok = $state === FTP_FINISHED;
		} elseif ($session['kind'] === 'scp') {
			$ok = $up ? $h->sendStream($stream, $remote, $tick) : $h->fetchStream($remote, $stream, $tick);
		} else {
			$ok = $up
				? (bool)@$h->put($remote, $stream, constant(get_class($h) . '::SOURCE_LOCAL_FILE'), -1, -1, $tick)
				: @$h->get($remote, $stream, 0, -1, $tick) !== false;
		}
		if (is_resource($stream)) {
			@fclose($stream);
		}
		if (!$ok || SpeedStream::position($id) !== $total) {
			throw new \RuntimeException($up
				? $this->l->t('Could not write the test file to %s. Choose a folder this account can write to.', [$remote])
				: $this->l->t('Could not read %s', [$remote]));
		}
		$seconds = max(0.001, microtime(true) - $t0);
		return ['seconds' => round($seconds, 3), 'mbps' => round($total * 8 / $seconds / 1e6, 2), 'bytesPerSecond' => (int)round($total / $seconds)];
	}

	// ---- small pieces the work above is made of

	/**
	 * A way to run commands on the far end, or null where there is none.
	 *
	 * SCP always has one — it is a shell — and runs it as the account chosen
	 * for sudo. An SFTP connection is asked once whether the same sign-in may
	 * run a command; an SFTP-only account says no. FTP never can.
	 *
	 * The command's own exit status decides success, carried back as a marker
	 * because a command run through sudo inside a terminal does not report one.
	 *
	 * @return null|\Closure(string): array{0: bool, 1: string}
	 */
	private function shellOf(array $session): ?\Closure {
		$h = $session['handle'];
		$key = is_object($h) ? spl_object_id($h) : 0;
		if (array_key_exists($key, $this->shells)) {
			return $this->shells[$key];
		}
		$run = null;
		if ($session['kind'] === 'scp') {
			$run = static fn (string $c): string => $h->run($c);
		} elseif ($session['kind'] === 'sftp' && method_exists($h, 'exec')) {
			try {
				$probe = @$h->exec('echo netbase-ok');
			} catch (\Throwable $e) {
				$probe = '';
			}
			if (is_string($probe) && str_contains($probe, 'netbase-ok')) {
				$run = static fn (string $c): string => (string)@$h->exec($c);
			}
		}
		$shell = $run === null ? null : static function (string $command) use ($run): array {
			$out = str_replace("\r\n", "\n", $run('{ ' . $command . '; } 2>&1; echo "netbase-rc=$?"'));
			if (!preg_match('/netbase-rc=(\d+)\s*$/', $out, $m)) {
				return [false, trim($out)];
			}
			return [(int)$m[1] === 0, trim(substr($out, 0, -strlen($m[0])))];
		};
		return $this->shells[$key] = $shell;
	}

	/**
	 * A command that may run for minutes: copying or compressing a large
	 * folder, changing a whole tree's permissions, searching a disk.
	 *
	 * phpseclib gives one command a fixed time to finish, and the web server
	 * cuts off a request that says nothing for a minute; a copy of a few
	 * gigabytes outlasts both and was reported as failed while it carried on.
	 * So the command is started in the background on the far end, in a session
	 * of its own, writing its output and exit status into a private folder, and
	 * is looked at every second. Each look is reported as progress, which keeps
	 * the request alive; a Stop ends the command and everything it started.
	 *
	 * @param \Closure(string): array{0: bool, 1: string} $sh
	 * @return array{0: bool, 1: string}
	 */
	private function longRun(array $session, \Closure $sh, string $command, callable $emit, string $label): array {
		$stage = $this->remoteStage($session);
		$at = static fn (string $f): string => escapeshellarg($stage . '/' . $f);
		// Looking is done as the account signed in, so a command run through
		// sudo is not asked for the password once a second (the files it
		// writes are readable: the folder is the sign-in's own).
		$look = static function (string $c) use ($session): string {
			$h = $session['handle'];
			return str_replace("\r\n", "\n", (string)($session['kind'] === 'scp' ? $h->runAsSelf($c) : @$h->exec($c)));
		};
		try {
			$inner = '{ ' . $command . '; } > ' . $at('out') . ' 2>&1; echo $? > ' . $at('rc.tmp') . '; mv ' . $at('rc.tmp') . ' ' . $at('rc');
			[$started] = $sh('S=; command -v setsid >/dev/null 2>&1 && S=setsid; $S sh -c ' . escapeshellarg($inner)
				. ' < /dev/null > /dev/null 2>&1 & echo $! > ' . $at('pid'));
			if (!$started) {
				throw new \RuntimeException($this->l->t('The server refused: %1$s %2$s', ['start', $label]));
			}
			$t0 = microtime(true);
			$wait = 200000;
			while (true) {
				usleep($wait);
				$wait = 1000000;
				$rc = trim($look('cat ' . $at('rc') . ' 2>/dev/null'));
				if ($rc !== '' && ctype_digit($rc)) {
					break;
				}
				if (!$emit(['stage' => 'progress', 'name' => $label, 'seconds' => (int)(microtime(true) - $t0)])) {
					// The command, and whatever it started: with setsid its id is its group's.
					$sh('P=$(cat ' . $at('pid') . ' 2>/dev/null); [ -n "$P" ] && { kill -TERM -- -"$P" 2>/dev/null || kill -TERM "$P"; }');
					throw new \RuntimeException('The transfer was stopped');
				}
			}
			$out = trim($look('cat ' . $at('out') . ' 2>/dev/null'));
			return [(int)$rc === 0, $out];
		} finally {
			$this->remoteUnstage($session, $stage);
		}
	}

	/** A private folder on the far end for something to pass through. */
	private function remoteStage(array $session): string {
		if ($session['kind'] === 'scp') {
			return $session['handle']->stage('733');
		}
		$out = (string)@$session['handle']->exec('d=$(mktemp -d "${TMPDIR:-/tmp}/netbase.XXXXXXXX") && chmod 700 "$d" && echo "$d"');
		$dir = trim($out);
		if ($dir === '' || $dir[0] !== '/' || str_contains($dir, "\n")) {
			throw new \RuntimeException('Could not make a temporary folder on the server.');
		}
		return $dir;
	}

	private function remoteUnstage(array $session, string $dir): void {
		if ($session['kind'] === 'scp') {
			$session['handle']->unstage($dir);
			return;
		}
		@$session['handle']->exec('rm -rf -- ' . escapeshellarg($dir));
	}

	/** A whole remote file into a file on this server. */
	private function fetchTo(array $session, string $remote, string $local, bool $asSelf = false): bool {
		$h = $session['handle'];
		return match ($session['kind']) {
			'ftp' => @ftp_get($h, $local, $remote, FTP_BINARY),
			'scp' => $h->fetchTo($remote, $local, $asSelf),
			default => @$h->get($remote, $local) !== false,
		};
	}

	/** A file on this server out to the far end. */
	private function sendFrom(array $session, string $local, string $remote): bool {
		$h = $session['handle'];
		return match ($session['kind']) {
			'ftp' => @ftp_put($h, $remote, $local, FTP_BINARY),
			'scp' => $h->sendFile($local, $remote),
			default => (bool)@$h->put($remote, $local, constant(get_class($h) . '::SOURCE_LOCAL_FILE')),
		};
	}

	private function removeRemoteFile(array $session, string $path): bool {
		return $session['kind'] === 'ftp' ? @ftp_delete($session['handle'], $path) : (bool)@$session['handle']->delete($path, false);
	}

	private function renameRemote(array $session, string $from, string $to): bool {
		return $session['kind'] === 'ftp' ? @ftp_rename($session['handle'], $from, $to) : (bool)@$session['handle']->rename($from, $to);
	}

	private function makeRemoteDir(array $session, string $path): bool {
		return $session['kind'] === 'ftp' ? @ftp_mkdir($session['handle'], $path) !== false : (bool)@$session['handle']->mkdir($path);
	}

	/** Put a finished file into the reader's Nextcloud folder. */
	private function storeInNextcloud(Folder $folder, string $name, string $local, bool $overwrite): void {
		$file = $overwrite && $folder->nodeExists($name) ? $folder->get($name) : $folder->newFile($name);
		if (!$file instanceof File) {
			throw new \RuntimeException('Could not write into your Nextcloud files');
		}
		$in = @fopen($local, 'rb');
		$out = $file->fopen('w');
		if (!is_resource($in) || !is_resource($out)) {
			throw new \RuntimeException('Could not write into your Nextcloud files');
		}
		try {
			stream_copy_to_stream($in, $out);
		} finally {
			fclose($in);
			fclose($out);
		}
		$this->refreshSize($file);
	}

	/** The entry at a path, from its folder's listing (read once per request). */
	private function entryOf(array $session, string $path): ?array {
		$dir = $this->dirOf($path);
		if (!isset($this->listed[$dir])) {
			try {
				$this->listed[$dir] = $this->readDir($session, $dir);
			} catch (\Throwable $e) {
				$this->listed[$dir] = [];
			}
		}
		$name = basename($path);
		foreach ($this->listed[$dir] as $e) {
			if (($e['name'] ?? null) === $name) {
				return $e;
			}
		}
		return null;
	}

	/** The folder a path is in: "/" for "/etc", "" for a name relative to where the session starts. */
	private function dirOf(string $path): string {
		$i = strrpos($path, '/');
		return $i === false ? '' : ($i === 0 ? '/' : substr($path, 0, $i));
	}

	private function joinRemote(string $dir, string $name): string {
		return $dir === '' ? $name : ($dir === '/' ? '/' . $name : rtrim($dir, '/') . '/' . $name);
	}

	/** "report.csv" becomes "report (2).csv" when the first is taken on the server. */
	private function uniqueRemote(array $session, string $dir, string $name): string {
		$lower = strtolower($name);
		$ext = str_ends_with($lower, '.tar.gz') ? '.tar.gz' : (pathinfo($name, PATHINFO_EXTENSION) !== '' ? '.' . pathinfo($name, PATHINFO_EXTENSION) : '');
		$base = $ext !== '' ? substr($name, 0, -strlen($ext)) : $name;
		for ($i = 2; $i < 500; $i++) {
			$candidate = $this->joinRemote($dir, $base . ' (' . $i . ')' . $ext);
			if ($this->entryOf($session, $candidate) === null) {
				return $candidate;
			}
		}
		return $this->joinRemote($dir, $base . '-' . bin2hex(random_bytes(4)) . $ext);
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
