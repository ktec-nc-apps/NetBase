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
	/** Longest a single terminal may stay open, in seconds. */
	private const LIFETIME = 7200;

	/** Closed after this long with nothing typed and nothing said. */
	private const IDLE = 1800;

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
			$emit("\r\n\033[31mNo SSH library is available on this server.\033[0m\r\n");
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
				$emit("\r\n\033[31mCould not sign in to " . $host . " as " . $user . ".\033[0m\r\n");
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
					$emit("\r\n\033[33mClosed after " . (int)(self::IDLE / 60) . " idle minutes.\033[0m\r\n");
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
