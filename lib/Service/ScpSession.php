<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/**
 * An SCP connection, wearing the same face as an SFTP one.
 *
 * SCP is not a file protocol in the way SFTP is. It copies a named file and
 * nothing else: there is no listing, no rename, no mkdir — phpseclib's SCP
 * class adds exactly two methods to an SSH connection, put() and get(). Yet a
 * server that offers SSH without the SFTP subsystem is a real thing, and on
 * such a machine SCP is the only way to move a file.
 *
 * So the missing half is supplied here, over the shell that SSH already gives:
 * listing is `ls`, removing is `rm`, and so on, each with its argument quoted
 * so a file called `; rm -rf /` is a file name and not a command. What comes
 * out is shaped exactly like phpseclib's SFTP replies, so the file-transfer
 * tool does not need to know which of the two it is talking to.
 *
 * The one real difference is ranged reads. SFTP can be asked for bytes 1000 to
 * 2000 of a file; SCP cannot — it hands over the whole file or nothing. The
 * file is therefore fetched once into a temporary file and the ranges are
 * served from that, which keeps the caller's chunked loop working unchanged.
 */
class ScpSession {
	/**
	 * Marks a transfer whose data comes from a callback.
	 *
	 * phpseclib's SFTP has a constant of this name and the transfer code looks
	 * it up on whichever class it was handed. One is declared here so that an
	 * SCP session answers the same question rather than being a special case
	 * everywhere it is used.
	 */
	public const SOURCE_CALLBACK = 16;

	/** Temporary copies of fetched files, removed when the session closes. */
	private array $fetched = [];

	/**
	 * Told how many bytes have arrived, while they are arriving.
	 *
	 * SCP hands over a whole file in one go, so the caller's chunked loop sees
	 * nothing until the fetch has finished — which made a large transfer look
	 * frozen at 0% and left Stop with nothing to stop. phpseclib does report
	 * progress during the fetch; this is where that report is passed on.
	 * Returning false from it abandons the transfer.
	 *
	 * @var null|callable(int): bool
	 */
	private $onProgress = null;

	/** @param null|callable(int): bool $tick */
	public function setProgress(?callable $tick): void {
		$this->onProgress = $tick;
	}

	/** A progress report that also sets the idle clock back, passing the count on. */
	private function alive(?callable $report): callable {
		$scp = $this->scp;
		return static function (int $n) use ($scp, $report): void {
			if (method_exists($scp, 'setTimeout')) {
				$scp->setTimeout(self::IDLE);
			}
			if ($report !== null) {
				$report($n);
			}
		};
	}

	/**
	 * The prompt sudo is told to print.
	 *
	 * A string of its own rather than sudo's own wording, because the reply has
	 * to be recognised whatever language the far end speaks, and because it is
	 * then removed from the output rather than shown to the reader as if the
	 * server had said it.
	 */
	private const SUDO_PROMPT = 'netbase-sudo-password:';

	/**
	 * How long a transfer may go without a byte moving, in seconds.
	 *
	 * phpseclib's timeout covers a whole SCP copy, not a pause in one: a copy
	 * that took longer than it — a few hundred MB on an ordinary line — was cut
	 * off after every byte had arrived and reported as a failure. Each report of
	 * progress sets the clock back, so the limit is on silence, not on size.
	 */
	private const IDLE = 30;

	/**
	 * @param \OCA\NetBase\Vendor\phpseclib3\Net\SCP|\phpseclib3\Net\SCP|\phpseclib\Net\SCP $scp an SSH connection that can also copy files
	 * @param string $sudoPassword the password for one request, or '' for no elevation.
	 *                              It is held in this object for the length of the
	 *                              request and written nowhere: not to the command
	 *                              line, not to a file, not to the database.
	 */
	public function __construct(private object $scp, private string $sudoPassword = '', private string $sudoUser = '') {
		// A password given with no account named is the old request, "act as
		// root". An account named with no password is a server where sudo asks
		// for none (NOPASSWD, or signing in as root to act as www-data).
		if ($this->sudoUser === '' && $this->sudoPassword !== '') {
			$this->sudoUser = 'root';
		}
		if ($this->sudoUser !== '' && !self::validUser($this->sudoUser)) {
			throw new \InvalidArgumentException('That is not an account name.');
		}
	}

	/** An account name sudo can be handed: letters, digits, dot, dash and underscore, not starting with a dash. */
	public static function validUser(string $name): bool {
		return (bool)preg_match('/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/', $name);
	}

	/** Whether commands are being run as another account through sudo. */
	public function elevated(): bool {
		return $this->sudoUser !== '';
	}

	/** The account commands are run as, or '' when they run as the one signed in. */
	public function actingAs(): string {
		return $this->sudoUser;
	}

	/** The server's own greeting, for the "does this work?" button. */
	public function getServerIdentification(): string {
		return method_exists($this->scp, 'getServerIdentification')
			? (string)$this->scp->getServerIdentification()
			: '';
	}

	/** Where a shell would start. */
	public function pwd(): string {
		$out = trim($this->run('pwd'));
		return $out !== '' ? $out : '/';
	}

	/**
	 * The home folder of the account acting, or '' when it has none to go to
	 * (nobody's is /nonexistent).
	 *
	 * sudo leaves the shell in the folder the account signed in started in, so
	 * pwd as www-data answers with the signed-in account's home, not /var/www.
	 * The home is looked up in the account database, and entered as that
	 * account, so what comes back is a folder it can actually open.
	 */
	public function home(): string {
		$who = $this->sudoUser;
		$command = $who === ''
			? 'cd && pwd'
			: 'h=$(getent passwd ' . escapeshellarg($who) . ' 2>/dev/null | cut -d: -f6); '
				. '[ -n "$h" ] || h=$(awk -F: -v u=' . escapeshellarg($who) . ' \'$1 == u { print $6 }\' /etc/passwd 2>/dev/null); '
				. '[ -n "$h" ] && cd "$h" 2>/dev/null && pwd';
		$lines = preg_split('/\r?\n/', trim($this->run($command))) ?: [];
		$home = trim((string)end($lines));
		return str_starts_with($home, '/') ? $home : '';
	}

	/**
	 * A directory, in the shape phpseclib's SFTP returns.
	 *
	 * `ls -la` with a numeric timestamp: the long format is the one thing every
	 * Unix agrees on, and asking for seconds since the epoch avoids the month
	 * names that differ with the server's language.
	 *
	 * @return array<string, array<string, mixed>>|false
	 */
	public function rawlist(string $path): array|false {
		$target = $path === '' ? '.' : $path;
		$out = $this->run('ls -la --time-style=+%s -- ' . escapeshellarg($target)
			. ' 2>/dev/null || ls -la -- ' . escapeshellarg($target));
		if (trim($out) === '') {
			return false;
		}
		$entries = [];
		foreach (preg_split('/\R/', $out) ?: [] as $line) {
			// mode, links, owner, group, size, stamp, name.
			//
			// The name is everything after the stamp, and a file may well be
			// called "report 2026.txt". So the stamp is matched for what it is
			// — one number from --time-style, or the three words of a plain
			// date — rather than left to a greedy group that would eat the
			// first word of the name with it. A trailing "." or "+" on the
			// mode is SELinux's or an ACL's mark, not part of the letters.
			$pattern = '/^([\-dlbcps])(\S{9})[.+]?\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+'
				. '(?:(\d{6,})|(\S+\s+\S+\s+\S+))\s+(.+)$/';
			if (preg_match($pattern, $line, $m) !== 1) {
				continue;
			}
			$stampText = $m[6] !== '' ? $m[6] : $m[7];
			$name = $m[8];
			// A symbolic link is written "name -> target"; the name is ours.
			$target = null;
			if ($m[1] === 'l' && str_contains($name, ' -> ')) {
				[$name, $target] = explode(' -> ', $name, 2);
			}
			if ($name === '.' || $name === '..') {
				continue;
			}
			$stamp = trim($stampText);
			$entries[$name] = [
				// 2 is what phpseclib calls a directory; 1 is an ordinary file.
				'type' => $m[1] === 'd' ? 2 : ($m[1] === 'l' ? 3 : 1),
				'target' => $target,
				'size' => (int)$m[5],
				'mtime' => ctype_digit($stamp) ? (int)$stamp : (int)strtotime($stamp),
				'permissions' => $this->modeBits($m[1] . $m[2]),
				'uid' => $m[3],
			];
		}
		return $entries;
	}

	/** The size of one file, or false when there is no such file. */
	public function filesize(string $path): int|false {
		$out = trim($this->run('stat -c %s -- ' . escapeshellarg($path)
			. ' 2>/dev/null || stat -f %z ' . escapeshellarg($path)));
		return ctype_digit($out) ? (int)$out : false;
	}

	/**
	 * Part of a file.
	 *
	 * SCP has no notion of an offset, so the whole file is fetched once and
	 * kept in a temporary file; every range after that is read from there. The
	 * signature matches SFTP's so the caller's loop is unchanged.
	 */
	public function get(string $path, bool|string $local = false, int $offset = 0, int $length = -1): string|false {
		// The copy itself is carried over the command's own input and output,
		// which is exactly where sudo would want to ask for a password, so it
		// cannot run under sudo. Acting as another account, the file is first
		// copied by that account into a folder only this sign-in can empty, and
		// fetched from there (getAs).
		$copy = $this->fetched[$path] ?? null;
		if ($copy === null) {
			$copy = tempnam(sys_get_temp_dir(), 'netbase-scp-');
			if ($copy === false) {
				return false;
			}
			// The third argument is phpseclib's own progress report, called with
			// the running byte count as the file arrives. Without it the fetch
			// is silent and uninterruptible; with it, SCP behaves like SFTP.
			$tick = $this->onProgress;
			$report = $tick === null ? null : static function (int $sofar) use ($tick): void {
				if (!$tick($sofar)) {
					// There is no way to return "stop" to phpseclib, so the only
					// way out of its loop is to leave it.
					throw new \RuntimeException('The transfer was stopped');
				}
			};
			try {
				$ok = $this->sudoUser === ''
					? @$this->scp->get($path, $copy, $this->alive($report))
					: $this->getAs($path, $copy, $report);
			} catch (\Throwable $e) {
				@unlink($copy);
				throw $e;
			}
			if ($ok === false) {
				@unlink($copy);
				return false;
			}
			$this->fetched[$path] = $copy;
		}
		$data = $length < 0
			? @file_get_contents($copy, false, null, $offset)
			: @file_get_contents($copy, false, null, $offset, $length);
		return $data === false ? false : $data;
	}

	/**
	 * Send a file.
	 *
	 * The caller hands over a reader rather than the bytes, because a file in
	 * Nextcloud may be larger than this process should hold. SCP wants a path,
	 * so the reader is drained into a temporary file first — the data crosses
	 * the disk once rather than the memory limit once.
	 */
	public function put(string $path, mixed $source, int $mode = self::SOURCE_CALLBACK): bool {
		if ($mode !== self::SOURCE_CALLBACK || !is_callable($source)) {
			if ($this->sudoUser === '') {
				return (bool)@$this->scp->put($path, (string)$source, $this->sourceString());
			}
			$text = (string)$source;
			$source = static function (int $length) use (&$text): ?string {
				if ($text === '') {
					return null;
				}
				$chunk = substr($text, 0, $length);
				$text = (string)substr($text, $length);
				return $chunk;
			};
		}
		$staging = tempnam(sys_get_temp_dir(), 'netbase-scp-');
		if ($staging === false) {
			return false;
		}
		$handle = @fopen($staging, 'wb');
		if (!is_resource($handle)) {
			@unlink($staging);
			return false;
		}
		try {
			while (true) {
				$chunk = $source(262144);
				if ($chunk === null || $chunk === '' || $chunk === false) {
					break;
				}
				if (@fwrite($handle, $chunk) === false) {
					return false;
				}
			}
		} finally {
			fclose($handle);
		}
		// The staging above only reads the file off this server's own disk,
		// which is quick and tells the reader nothing useful. What is worth
		// showing is the send that follows, so that is what is reported.
		$tick = $this->onProgress;
		$report = $tick === null ? null : static function (int $sent) use ($tick): void {
			if (!$tick($sent)) {
				throw new \RuntimeException('The transfer was stopped');
			}
		};
		try {
			$ok = $this->sudoUser === ''
				? (bool)@$this->scp->put($path, $staging, $this->sourceLocalFile(), $this->alive($report))
				: $this->putAs($path, $staging, $report);
		} catch (\Throwable $e) {
			@unlink($staging);
			throw $e;
		}
		@unlink($staging);
		return $ok;
	}

	public function mkdir(string $path): bool {
		return $this->did('mkdir -- ' . escapeshellarg($path));
	}

	public function rmdir(string $path): bool {
		return $this->did('rmdir -- ' . escapeshellarg($path));
	}

	public function delete(string $path, bool $recursive = false): bool {
		return $this->did('rm ' . ($recursive ? '-r ' : '') . '-f -- ' . escapeshellarg($path));
	}

	public function rename(string $from, string $to): bool {
		return $this->did('mv -- ' . escapeshellarg($from) . ' ' . escapeshellarg($to));
	}

	public function chmod(int $mode, string $path): bool {
		return $this->did('chmod ' . sprintf('%04o', $mode & 07777) . ' -- ' . escapeshellarg($path));
	}

	/**
	 * The owner, the group and the timestamp — the same order of arguments the
	 * SFTP class uses, so the caller does not have to know which it is talking
	 * to. Each of these needs root on most servers, which is what "act as root"
	 * is for; without it the far end refuses and says so.
	 */
	public function chown(string $path, int|string $owner): bool {
		$owner = trim((string)$owner);
		if ($owner === '' || !preg_match('/^[A-Za-z0-9._-]{1,64}$/', $owner)) {
			return false;
		}
		return $this->did('chown -- ' . escapeshellarg($owner) . ' ' . escapeshellarg($path));
	}

	public function chgrp(string $path, int|string $group): bool {
		$group = trim((string)$group);
		if ($group === '' || !preg_match('/^[A-Za-z0-9._-]{1,64}$/', $group)) {
			return false;
		}
		return $this->did('chgrp -- ' . escapeshellarg($group) . ' ' . escapeshellarg($path));
	}

	public function touch(string $path, ?int $time = null): bool {
		$when = $time === null ? '' : '-d @' . (int)$time . ' ';
		return $this->did('touch ' . $when . '-- ' . escapeshellarg($path));
	}

	/** Close the connection and take the temporary copies with it. */
	public function disconnect(): void {
		foreach ($this->fetched as $copy) {
			@unlink($copy);
		}
		$this->fetched = [];
		if (method_exists($this->scp, 'disconnect')) {
			@$this->scp->disconnect();
		}
	}

	// ------------------------------------------------- as another account

	/**
	 * A folder on the far end for one file to pass through.
	 *
	 * It is made by the account that signed in, so that account can always
	 * empty it again, whatever the file inside belongs to. Others may enter it
	 * but not list it, and the file is given a random name: the account acting
	 * through sudo can put a file there or take one out, nobody else can find
	 * it. 733 lets that account write into it; 711 is enough for it to read.
	 */
	public function stage(string $mode): string {
		$out = @$this->scp->exec('d=$(mktemp -d "${TMPDIR:-/tmp}/netbase.XXXXXXXX") && chmod ' . $mode . ' "$d" && echo "$d"');
		$dir = trim(str_replace("\r", '', (string)$out));
		if ($dir === '' || $dir[0] !== '/' || str_contains($dir, "\n")) {
			throw new \RuntimeException('Could not make a temporary folder on the server.');
		}
		return $dir;
	}

	public function unstage(string $dir): void {
		@$this->scp->exec('rm -rf -- ' . escapeshellarg($dir));
	}

	/** A whole file into a file on this server, as whichever account is acting. */
	public function fetchTo(string $remote, string $local, bool $asSelf = false, ?callable $report = null): bool {
		return $this->sudoUser === '' || $asSelf
			? @$this->scp->get($remote, $local, $this->alive($report)) !== false
			: $this->getAs($remote, $local, $report);
	}

	/** A file on this server out to the far end, as whichever account is acting. */
	public function sendFile(string $local, string $remote, ?callable $report = null): bool {
		return $this->sudoUser === ''
			? (bool)@$this->scp->put($remote, $local, $this->sourceLocalFile(), $this->alive($report))
			: $this->putAs($remote, $local, $report);
	}

	/** Send what a stream gives, as the account signed in (the speed test). */
	public function sendStream($stream, string $remote, ?callable $report = null): bool {
		// A stream is read only when the mode is not SOURCE_STRING: with that
		// mode phpseclib's SCP takes substr() of the stream itself.
		return (bool)@$this->scp->put($remote, $stream, $this->sourceLocalFile(), $this->alive($report));
	}

	/** Fetch into a stream, as the account signed in (the speed test). */
	public function fetchStream(string $remote, $stream, ?callable $report = null): bool {
		return @$this->scp->get($remote, $stream, $this->alive($report)) !== false;
	}

	/** One command, unelevated, as the account that signed in. */
	public function runAsSelf(string $command): string {
		$out = @$this->scp->exec($command);
		return is_string($out) ? $out : '';
	}

	/** Fetch a file the chosen account can read and the signed-in one may not. */
	private function getAs(string $path, string $local, ?callable $report): bool {
		$dir = $this->stage('733');
		$copy = $dir . '/' . bin2hex(random_bytes(16));
		try {
			if (!$this->did('cp -- ' . escapeshellarg($path) . ' ' . escapeshellarg($copy) . ' && chmod 0644 ' . escapeshellarg($copy))) {
				return false;
			}
			return @$this->scp->get($copy, $local, $this->alive($report)) !== false;
		} finally {
			$this->unstage($dir);
		}
	}

	/**
	 * Write a file as the chosen account.
	 *
	 * The bytes go to the staging folder first, as the signed-in account, and
	 * the chosen account then writes them over the target with cat. Writing
	 * into the file rather than replacing it keeps an existing file's owner and
	 * permissions: config.php edited as root stays www-data's.
	 */
	private function putAs(string $path, string $staging, ?callable $report): bool {
		$dir = $this->stage('711');
		$copy = $dir . '/' . bin2hex(random_bytes(16));
		try {
			if (!@$this->scp->put($copy, $staging, $this->sourceLocalFile(), $this->alive($report))) {
				return false;
			}
			@$this->scp->exec('chmod 0644 -- ' . escapeshellarg($copy));
			return $this->did('cat -- ' . escapeshellarg($copy) . ' > ' . escapeshellarg($path));
		} finally {
			$this->unstage($dir);
		}
	}

	// ---------------------------------------------------------------- inside

	/**
	 * Run one command and hand back what it printed.
	 *
	 * Without elevation this is one exec and nothing more. With it, the command
	 * goes through sudo and the password is *written to the channel* once sudo
	 * asks for it — never placed on the command line, where every other user of
	 * that machine could read it out of the process list.
	 */
	public function run(string $command): string {
		if ($this->sudoUser === '') {
			$out = @$this->scp->exec($command);
			return is_string($out) ? $out : '';
		}
		return $this->runElevated($command);
	}

	/**
	 * One command as the chosen account.
	 *
	 * A terminal is opened for the length of the command because sudo will only
	 * read a password from one. What comes back has sudo's prompt taken off the
	 * front, so the caller sees the command's own output and nothing else.
	 *
	 * sudo does not always ask. Where it is set up to need no password, or the
	 * account signed in is root, the command simply runs: what arrives before
	 * any prompt is then the whole reply. Writing the password into a channel
	 * that had already closed lost that reply and showed every folder as empty.
	 *
	 * A wrong password is not retried. sudo asks three times by default; the
	 * second prompt is the sign of a refusal, and the command is broken off
	 * there rather than left waiting for an answer that will not come.
	 */
	private function runElevated(string $command): string {
		if (!method_exists($this->scp, 'enablePTY')) {
			throw new \RuntimeException('This server\'s SSH library cannot run a command as another account.');
		}
		try {
			$this->scp->enablePTY();
			// The command goes inside a shell of its own. Handed to sudo directly,
			// a command containing "2>/dev/null || ..." would apply that redirect to
			// *sudo*, throwing away its password prompt and its refusal, and would
			// then run the half after "||" unelevated. The failure was silent: an
			// empty reply that read as "this directory is empty".
			@$this->scp->exec('sudo -S -p ' . escapeshellarg(self::SUDO_PROMPT)
				. ' -u ' . escapeshellarg($this->sudoUser)
				. ' -- sh -c ' . escapeshellarg($command) . ' 2>&1');
			$out = (string)@$this->scp->read(self::SUDO_PROMPT);
			if (str_contains($out, self::SUDO_PROMPT)) {
				if ($this->sudoPassword === '') {
					$this->breakOff();
					throw new \RuntimeException('This server asks for the sudo password.');
				}
				@$this->scp->write($this->sudoPassword . "\n");
				$out = (string)@$this->scp->read(self::SUDO_PROMPT);
				if (str_contains($out, self::SUDO_PROMPT)) {
					$this->breakOff();
					throw new \RuntimeException('That sudo password was not accepted by the server.');
				}
			}
		} finally {
			if (method_exists($this->scp, 'disablePTY')) {
				@$this->scp->disablePTY();
			}
		}
		$out = str_replace(self::SUDO_PROMPT, '', $out);
		// A terminal echoes a blank line after the password is typed.
		$out = (string)preg_replace('/\A\s*\r?\n/', '', $out);
		// The terminal also turns every line ending into \r\n.
		$out = str_replace("\r\n", "\n", $out);
		if (preg_match('/Sorry, try again|incorrect password|authentication failure/i', $out)) {
			throw new \RuntimeException('That sudo password was not accepted by the server.');
		}
		if (preg_match('/is not in the sudoers file|not allowed to execute|unknown user|no passwd entry/i', $out)) {
			throw new \RuntimeException($this->sudoUser === 'root'
				? 'That account is not allowed to use sudo on this server.'
				: 'This account may not act as that user on this server, or there is no such user.');
		}
		return $out;
	}

	/** Stop sudo that is still waiting for a password, and let the channel close. */
	private function breakOff(): void {
		try {
			@$this->scp->write("\x03");
			@$this->scp->read();
		} catch (\Throwable $e) {
			// The channel may already be gone, which is what was wanted.
		}
	}

	/**
	 * Run one command and say whether it worked.
	 *
	 * The printed mark is what decides it when the command ran as root: a
	 * terminal was opened for that, and the exit status of a command run inside
	 * one belongs to the terminal, not to the command. Believing it there would
	 * report every failed delete as a success.
	 */
	public function did(string $command): bool {
		$out = $this->run($command . ' && echo netbase-ok');
		if ($this->sudoUser !== '') {
			return str_contains($out, 'netbase-ok');
		}
		// The exit status is the honest answer where the server reports one;
		// the echo is the fallback for a shell that does not. "No status" is not
		// a success: read that way, a failed rm or mv on a server that never
		// sends one showed as done (review 2026-10-04, low 10).
		$status = method_exists($this->scp, 'getExitStatus') ? $this->scp->getExitStatus() : null;
		if (is_int($status)) {
			return $status === 0;
		}
		return str_contains($out, 'netbase-ok');
	}

	/**
	 * Permissions as a number, the way phpseclib reports them.
	 *
	 * The letters carry their own weight — r is four, w is two, x is one — so
	 * they are added as they are. Shifting them again by their position would
	 * count the same bit twice and turn 0640 into 0600.
	 */
	private function modeBits(string $text): int {
		$bits = $text[0] === 'd' ? 040000 : ($text[0] === 'l' ? 0120000 : 0100000);
		$order = ['r' => 4, 'w' => 2, 'x' => 1, 's' => 1, 't' => 1];
		for ($group = 0; $group < 3; $group++) {
			$value = 0;
			for ($i = 0; $i < 3; $i++) {
				$char = strtolower($text[1 + $group * 3 + $i] ?? '-');
				$value |= $order[$char] ?? 0;
			}
			$bits |= $value << ((2 - $group) * 3);
		}
		return $bits;
	}

	private function sourceLocalFile(): int {
		return (int)constant(get_class($this->scp) . '::SOURCE_LOCAL_FILE');
	}

	private function sourceString(): int {
		return (int)constant(get_class($this->scp) . '::SOURCE_STRING');
	}
}
