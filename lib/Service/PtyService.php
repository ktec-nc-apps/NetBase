<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\EndpointEntity;
use Psr\Log\LoggerInterface;

/**
 * A real terminal on a server, not a line at a time.
 *
 * Running one command per request cannot show a password prompt, cannot run
 * an editor, and cannot run anything that draws — which is most of what an
 * administrator actually does at a console. A terminal needs one connection
 * that stays open and a screen that understands where the cursor went.
 *
 * PHP has no way to hold an SSH connection between two requests, so the
 * request that carries the output *is* the session: it opens the connection,
 * streams what the server says as it says it, and picks up keystrokes from a
 * small file that the typing request appends to. When the browser goes away
 * the write fails, the loop notices, and the connection closes with it.
 *
 * Credentials never touch that file. They arrive with the streaming request
 * and stay in its memory.
 */
class PtyService {
	/**
	 * Longest a single terminal may stay open, in seconds.
	 *
	 * A shell left open is a shell someone else can walk up to, so these are
	 * kept short for a tool that runs commands on the server: an hour at the
	 * outside, and a quarter of an hour with nobody typing.
	 */
	private const LIFETIME = 3600;

	/** Closed after this long with nothing typed and nothing said. */
	private const IDLE = 900;

	/** How long each read waits before going back to look for keystrokes. */
	private const SLICE = 0.04;

	/** Room for connecting and signing in. */
	private const HANDSHAKE = 15.0;

	/**
	 * How long the first read may take.
	 *
	 * phpseclib's read() does not return the moment something arrives — it
	 * gathers until its timeout expires — so this is paid in full, once, for
	 * the shell's opening banner.
	 */
	private const OPENING = 0.4;

	public function __construct(
		private EndpointService $endpoints,
		// What a terminal says for itself is written here, on the server, so it
		// has to be translated here too.
		private L10nService $l,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Hold one terminal open, writing everything the server says to $emit.
	 *
	 * @param callable(string): bool $emit returns false once the browser is gone
	 */
	public function serve(EndpointEntity $endpoint, string $userId, string $session, int $cols, int $rows, callable $emit): void {
		$class = ProbeService::ssh2Class();
		if ($class === null) {
			$emit("\r\n\033[31m" . $this->l->t('No SSH library is available on this server.') . "\033[0m\r\n");
			return;
		}
		$dir = $this->sessionDir($userId, $session, true);
		$host = (string)$endpoint->getHost();
		$port = (int)$endpoint->getPort() ?: 22;
		$user = (string)$endpoint->getUsername();

		// The short slice below belongs to the loop only. Key exchange and
		// sign-in need room: phpseclib treats a timeout in the middle of one
		// of those packets as a lost connection and hangs up.
		$ssh = new $class($host, $port, self::HANDSHAKE);
		$ssh->setWindowSize(max(20, min(500, $cols)), max(5, min(200, $rows)));

		$credentials = $this->endpoints->credentials($endpoint);
		$secret = $credentials['key'] !== ''
			? TransferService::loadPrivateKey($credentials['key'], $credentials['passphrase'])
			: $credentials['password'];

		try {
			if (!@$ssh->login($user, $secret)) {
				$emit("\r\n\033[31m" . $this->l->t('Could not sign in to %1$s as %2$s.', [$host, $user]) . "\033[0m\r\n");
				return;
			}
		} catch (\Throwable $e) {
			$emit("\r\n\033[31m" . $e->getMessage() . "\033[0m\r\n");
			return;
		}

		$deadline = time() + self::LIFETIME;
		$quiet = time();
		try {
			// The first read is what starts the shell — phpseclib asks for a
			// pty and a login shell the moment an interactive channel is
			// wanted — and a login shell takes longer than one slice to draw
			// its first prompt.
			// Open the shell under the generous timeout, not the short one.
			// Opening it means a channel request, a pty request and a shell
			// request, each waiting for the server to agree; phpseclib treats a
			// timeout there as "no answer yet" and carries on regardless, and
			// the next packet it builds then refers to a channel that was
			// never granted.
			$ssh->setTimeout(self::HANDSHAKE);
			if (method_exists($ssh, 'openShell')) {
				$ssh->openShell();
			}
			$ssh->setTimeout(self::OPENING);
			$opening = (string)$ssh->read();
			if ($opening !== '' && !$emit($opening)) {
				return;
			}
			$ssh->setTimeout(self::SLICE);
			while (time() < $deadline) {
				if (file_exists($dir . '/close')) {
					break;
				}
				$typed = $this->take($dir . '/in');
				if ($typed !== '') {
					$ssh->write($typed);
					$quiet = time();
				}
				$resize = $this->take($dir . '/size');
				if ($resize !== '') {
					[$c, $r] = array_pad(explode(' ', trim($resize)), 2, '');
					if (ctype_digit($c) && ctype_digit($r)) {
						$ssh->setWindowSize(max(20, min(500, (int)$c)), max(5, min(200, (int)$r)));
					}
				}
				$said = $ssh->read();
				if ($said === false) {
					break;
				}
				if ($said !== '') {
					$quiet = time();
					if (!$emit($said)) {
						return;
					}
				} elseif (!$emit('')) {
					// Nothing to say, but the write still tells us whether
					// anybody is still listening.
					return;
				}
				if (time() - $quiet > self::IDLE) {
					$emit("\r\n\033[33m" . $this->l->t('Closed after %d idle minutes.', [(int)(self::IDLE / 60)]) . "\033[0m\r\n");
					break;
				}
			}
		} catch (\Throwable $e) {
			$this->logger->debug('NetBase terminal ended', ['exception' => $e]);
		} finally {
			try {
				$ssh->disconnect();
			} catch (\Throwable) {
			}
			$this->forget($userId, $session);
		}
	}

	/**
	 * A terminal on THIS server, not a remote one.
	 *
	 * The same illusion as the SSH terminal, but there is no connection to
	 * make: a small Python helper opens a real pseudo-terminal, runs a login
	 * shell inside it with exactly the privileges Nextcloud already has, and
	 * bridges it to ordinary pipes. Keystrokes go in on the helper's stdin,
	 * what the shell draws comes back on its stdout, and the window size is
	 * left in the session's `size` file for the helper to pick up — the same
	 * file the SSH terminal already uses, so resize needs nothing new.
	 *
	 * @param callable(string): bool $emit returns false once the browser is gone
	 */
	public function serveLocal(string $userId, string $session, int $cols, int $rows, callable $emit, array $extraEnv = []): void {
		if (!function_exists('proc_open')) {
			$emit("\r\n\033[31m" . $this->l->t('proc_open() is disabled on this server, so a local shell cannot be opened.') . "\033[0m\r\n");
			return;
		}
		$python = self::findPython();
		if ($python === null) {
			$emit("\r\n\033[31m" . $this->l->t('python3 is required for the local shell and was not found on this server.') . "\033[0m\r\n");
			return;
		}
		$bridge = self::bridgePath();
		if ($bridge === null) {
			$emit("\r\n\033[31m" . $this->l->t('The shell helper (pty-bridge.py) is missing from the app.') . "\033[0m\r\n");
			return;
		}
		$dir = $this->sessionDir($userId, $session, true);
		if ($dir === '') {
			$emit("\r\n\033[31m" . $this->l->t('Bad session.') . "\033[0m\r\n");
			return;
		}

		$cols = max(20, min(500, $cols));
		$rows = max(5, min(200, $rows));
		@file_put_contents($dir . '/size', $cols . ' ' . $rows, LOCK_EX);

		$home = (string)(getenv('HOME') ?: '/var/www');
		$env = [
			'TERM' => 'xterm-256color',
			'LANG' => (string)(getenv('LANG') ?: 'C.UTF-8'),
			'PATH' => (string)(getenv('PATH') ?: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'),
			'HOME' => $home,
			'PWD' => $home,
		];
		// What the account asked for — a language, and whatever else it set —
		// wins over these defaults.
		foreach ($extraEnv as $name => $value) {
			if (is_string($name) && $name !== '') {
				$env[$name] = (string)$value;
			}
		}
		$descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
		$command = [$python, $bridge, $dir . '/size', (string)$cols, (string)$rows];
		$proc = @proc_open($command, $descriptors, $pipes, $home, $env);
		if (!is_resource($proc)) {
			$emit("\r\n\033[31m" . $this->l->t('Could not start a shell on this server.') . "\033[0m\r\n");
			$this->forget($userId, $session);
			return;
		}
		stream_set_blocking($pipes[1], false);
		stream_set_blocking($pipes[2], false);

		$deadline = time() + self::LIFETIME;
		$quiet = time();
		try {
			while (time() < $deadline) {
				if (file_exists($dir . '/close')) {
					break;
				}
				$state = proc_get_status($proc);
				if (!$state['running']) {
					break;
				}
				$typed = $this->take($dir . '/in');
				if ($typed !== '') {
					@fwrite($pipes[0], $typed);
					@fflush($pipes[0]);
					$quiet = time();
				}
				$read = [$pipes[1], $pipes[2]];
				$write = null;
				$except = null;
				$ready = @stream_select($read, $write, $except, 0, (int)(self::SLICE * 1000000));
				$said = '';
				if ($ready) {
					foreach ($read as $stream) {
						$chunk = fread($stream, 65536);
						if ($chunk !== false && $chunk !== '') {
							$said .= $chunk;
						}
					}
				}
				if ($said !== '') {
					$quiet = time();
					if (!$emit($said)) {
						return;
					}
				} elseif (!$emit('')) {
					return;
				}
				if (time() - $quiet > self::IDLE) {
					$emit("\r\n\033[33m" . $this->l->t('Closed after %d idle minutes.', [(int)(self::IDLE / 60)]) . "\033[0m\r\n");
					break;
				}
			}
		} catch (\Throwable $e) {
			$this->logger->debug('NetBase local terminal ended', ['exception' => $e]);
		} finally {
			foreach ($pipes as $pipe) {
				if (is_resource($pipe)) {
					@fclose($pipe);
				}
			}
			// Close the keystroke pipe first (done above), then stop the helper
			// — which sends the shell a hang-up on its way out.
			try {
				proc_terminate($proc, 9);
			} catch (\Throwable) {
			}
			@proc_close($proc);
			$this->forget($userId, $session);
		}
	}

	/** Whether this server can open a local shell at all. */
	public function localShellAvailable(): bool {
		return function_exists('proc_open') && self::findPython() !== null && self::bridgePath() !== null;
	}

	/** The shell helper that ships with the app. */
	private static function bridgePath(): ?string {
		$path = realpath(__DIR__ . '/../../resources/pty-bridge.py');
		return ($path !== false && is_file($path)) ? $path : null;
	}

	/** The python3 interpreter, found on PATH, or null if there is none. */
	private static function findPython(): ?string {
		foreach (['/usr/bin/python3', '/usr/local/bin/python3', '/bin/python3'] as $fixed) {
			if (is_executable($fixed)) {
				return $fixed;
			}
		}
		$path = (string)(getenv('PATH') ?: '/usr/bin:/bin:/usr/local/bin');
		foreach (explode(PATH_SEPARATOR, $path) as $dir) {
			$dir = rtrim($dir, '/');
			if ($dir === '') {
				continue;
			}
			$candidate = $dir . '/python3';
			if (is_executable($candidate)) {
				return $candidate;
			}
		}
		return null;
	}

	/** Keystrokes, on their way to a terminal already open. */
	public function type(string $userId, string $session, string $data): bool {
		$dir = $this->sessionDir($userId, $session, false);
		if ($dir === '' || !is_dir($dir)) {
			return false;
		}
		return file_put_contents($dir . '/in', $data, FILE_APPEND | LOCK_EX) !== false;
	}

	/** The window changed shape; the far end has to be told. */
	public function resize(string $userId, string $session, int $cols, int $rows): bool {
		$dir = $this->sessionDir($userId, $session, false);
		if ($dir === '' || !is_dir($dir)) {
			return false;
		}
		return file_put_contents($dir . '/size', $cols . ' ' . $rows, LOCK_EX) !== false;
	}

	/** Asked to hang up. */
	public function hangUp(string $userId, string $session): bool {
		$dir = $this->sessionDir($userId, $session, false);
		if ($dir === '' || !is_dir($dir)) {
			return false;
		}
		return touch($dir . '/close');
	}

	/** Read a file and empty it in one go, so nothing is typed twice. */
	private function take(string $path): string {
		if (!file_exists($path)) {
			return '';
		}
		$handle = @fopen($path, 'c+');
		if ($handle === false) {
			return '';
		}
		$out = '';
		if (flock($handle, LOCK_EX)) {
			$out = (string)stream_get_contents($handle);
			ftruncate($handle, 0);
			fflush($handle);
			flock($handle, LOCK_UN);
		}
		fclose($handle);
		return $out;
	}

	/**
	 * Where one person's one terminal keeps its keystrokes.
	 *
	 * The name is a hash of the account and the session, so no request can
	 * name a directory belonging to anybody else however the session is
	 * spelt, and a stale directory says nothing about who owned it.
	 */
	private function sessionDir(string $userId, string $session, bool $create): string {
		if (preg_match('/^[a-f0-9]{16,64}$/', $session) !== 1) {
			return '';
		}
		$base = sys_get_temp_dir() . '/netbase-terminals';
		if ($create && !is_dir($base)) {
			@mkdir($base, 0700, true);
		}
		$dir = $base . '/' . hash('sha256', $userId . "\0" . $session);
		if ($create && !is_dir($dir)) {
			@mkdir($dir, 0700, true);
			$this->sweep($base);
		}
		return $dir;
	}

	private function forget(string $userId, string $session): void {
		$dir = $this->sessionDir($userId, $session, false);
		if ($dir === '' || !is_dir($dir)) {
			return;
		}
		foreach (['in', 'size', 'close'] as $name) {
			@unlink($dir . '/' . $name);
		}
		@rmdir($dir);
	}

	/** Clear away anything a crashed request left behind. */
	private function sweep(string $base): void {
		$old = time() - self::LIFETIME - 600;
		foreach ((array)@scandir($base) as $name) {
			if ($name === '.' || $name === '..') {
				continue;
			}
			$dir = $base . '/' . $name;
			if (is_dir($dir) && (int)@filemtime($dir) < $old) {
				foreach ((array)@scandir($dir) as $file) {
					if ($file !== '.' && $file !== '..') {
						@unlink($dir . '/' . $file);
					}
				}
				@rmdir($dir);
			}
		}
	}
}
