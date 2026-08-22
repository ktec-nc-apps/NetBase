<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use Psr\Log\LoggerInterface;

/**
 * Credential-free service probes: what a port is running, and whether what it
 * offers is still safe to use.
 *
 * SSH is read straight off the wire — the identification string and the
 * KEXINIT packet the server sends before anything is encrypted give the full
 * algorithm list without logging in. The host key fingerprint additionally
 * needs a key exchange, which is done with the phpseclib copy Nextcloud
 * already ships.
 */
class ProbeService {
	/** Algorithms nobody should still be offering, with the reason. */
	private const WEAK = [
		'diffie-hellman-group1-sha1' => 'a 1024-bit group with SHA-1',
		'diffie-hellman-group14-sha1' => 'SHA-1 based key exchange',
		'diffie-hellman-group-exchange-sha1' => 'SHA-1 based key exchange',
		'ssh-rsa' => 'RSA with SHA-1 signatures',
		'ssh-dss' => 'DSA, limited to 1024 bits',
		'arcfour' => 'the broken RC4 cipher',
		'arcfour128' => 'the broken RC4 cipher',
		'arcfour256' => 'the broken RC4 cipher',
		'3des-cbc' => 'triple DES in CBC mode',
		'blowfish-cbc' => 'a 64-bit block cipher in CBC mode',
		'cast128-cbc' => 'a 64-bit block cipher in CBC mode',
		'aes128-cbc' => 'CBC mode, vulnerable to the SSH packet attack',
		'aes192-cbc' => 'CBC mode, vulnerable to the SSH packet attack',
		'aes256-cbc' => 'CBC mode, vulnerable to the SSH packet attack',
		'hmac-md5' => 'MD5',
		'hmac-md5-96' => 'truncated MD5',
		'hmac-sha1' => 'SHA-1',
		'hmac-sha1-96' => 'truncated SHA-1',
		'none' => 'no integrity protection at all',
	];

	public function __construct(
		private ToolService $tools,
		private L10nService $l,
		private LoggerInterface $logger,
	) {
	}

	public static function ssh2Class(): ?string {
		foreach (['phpseclib3\\Net\\SSH2', 'phpseclib\\Net\\SSH2'] as $class) {
			if (class_exists($class)) {
				return $class;
			}
		}
		return null;
	}

	// ------------------------------------------------------------------ SSH

	/**
	 * @return array<string, mixed>
	 */
	public function ssh(string $host, int $port = 22, bool $hostKey = true, bool $authMethods = false, float $timeout = 8.0): array {
		$host = $this->tools->validateHost($host);
		$port = max(1, min(65535, $port));
		$started = microtime(true);
		$out = [
			'host' => $host, 'port' => $port, 'ok' => false, 'banner' => null, 'software' => null,
			'algorithms' => [], 'hostKeys' => [], 'authMethods' => null, 'error' => null, 'findings' => [],
		];

		$errno = 0;
		$errstr = '';
		$target = str_contains($host, ':') && filter_var($host, FILTER_VALIDATE_IP) !== false ? '[' . $host . ']' : $host;
		$stream = @stream_socket_client('tcp://' . $target . ':' . $port, $errno, $errstr, $timeout);
		if ($stream === false) {
			$out['error'] = $errstr !== '' ? $errstr : 'Could not connect';
			$out['findings'][] = $this->finding('bad', 'Connection', $out['error']);
			return $out;
		}
		stream_set_timeout($stream, (int)$timeout);

		try {
			// The server may send informational lines before its identification.
			$banner = '';
			for ($i = 0; $i < 20; $i++) {
				$line = @fgets($stream, 512);
				if ($line === false) {
					break;
				}
				$line = rtrim($line, "\r\n");
				if (str_starts_with($line, 'SSH-')) {
					$banner = $line;
					break;
				}
			}
			if ($banner === '') {
				throw new \RuntimeException('The service did not identify itself as SSH');
			}
			$out['banner'] = $banner;
			$parts = explode('-', $banner, 3);
			$out['protocol'] = $parts[1] ?? null;
			$out['software'] = $parts[2] ?? null;

			@fwrite($stream, "SSH-2.0-NetBase_probe\r\n");
			$out['algorithms'] = $this->readKexInit($stream);
			$out['ok'] = true;
		} catch (\Throwable $e) {
			$out['error'] = $e->getMessage();
		} finally {
			@fclose($stream);
		}

		if ($hostKey && $out['ok']) {
			$out['hostKeys'] = $this->sshHostKey($host, $port, $timeout, $authMethods, $out['authMethods']);
		}
		$out['seconds'] = round(microtime(true) - $started, 3);
		$out['findings'] = array_merge($out['findings'], $this->sshFindings($out));
		return $out;
	}

	/** @return array<string, list<string>> */
	private function readKexInit($stream): array {
		$header = $this->readExactly($stream, 5);
		$length = unpack('N', substr($header, 0, 4))[1] ?? 0;
		$padding = ord($header[4]);
		if ($length < 2 || $length > 262144) {
			throw new \RuntimeException('The server sent an unexpected packet');
		}
		$payload = $this->readExactly($stream, $length - 1);
		$payload = substr($payload, 0, strlen($payload) - $padding);
		if ($payload === '' || ord($payload[0]) !== 20) {
			throw new \RuntimeException('The server did not offer a key exchange');
		}
		$offset = 17; // message type + 16-byte cookie
		$names = [
			'kex', 'hostKey', 'encryptionClientToServer', 'encryptionServerToClient',
			'macClientToServer', 'macServerToClient', 'compressionClientToServer',
			'compressionServerToClient', 'languagesClientToServer', 'languagesServerToClient',
		];
		$out = [];
		foreach ($names as $name) {
			if ($offset + 4 > strlen($payload)) {
				break;
			}
			$size = unpack('N', substr($payload, $offset, 4))[1] ?? 0;
			$offset += 4;
			$value = substr($payload, $offset, $size);
			$offset += $size;
			$out[$name] = $value === '' ? [] : explode(',', $value);
		}
		return $out;
	}

	private function readExactly($stream, int $bytes): string {
		$data = '';
		while (strlen($data) < $bytes) {
			$chunk = @fread($stream, $bytes - strlen($data));
			if ($chunk === false || $chunk === '') {
				break;
			}
			$data .= $chunk;
		}
		if (strlen($data) < $bytes) {
			throw new \RuntimeException('The connection closed while reading the key exchange');
		}
		return $data;
	}

	/** @return array<int, array<string, mixed>> */
	private function sshHostKey(string $host, int $port, float $timeout, bool $authMethods, mixed &$methods): array {
		$class = self::ssh2Class();
		if ($class === null) {
			return [];
		}
		try {
			$ssh = new $class($host, $port, (int)$timeout);
			$key = @$ssh->getServerPublicHostKey();
			$keys = [];
			if (is_string($key) && $key !== '') {
				[$type, $blob] = array_pad(explode(' ', $key, 2), 2, '');
				$raw = base64_decode(trim($blob), true);
				if (is_string($raw) && $raw !== '') {
					$keys[] = [
						'type' => $type,
						'bits' => $this->hostKeyBits($type, $raw),
						'sha256' => 'SHA256:' . rtrim(base64_encode(hash('sha256', $raw, true)), '='),
						'md5' => 'MD5:' . implode(':', str_split(md5($raw), 2)),
					];
				}
			}
			if ($authMethods) {
				// A deliberate failed sign-in: it tells us which methods the
				// server will accept, at the price of one line in its auth log.
				@$ssh->login('netbase-probe-' . bin2hex(random_bytes(3)), bin2hex(random_bytes(8)));
				if (method_exists($ssh, 'getAuthMethodsToContinue')) {
					$found = @$ssh->getAuthMethodsToContinue();
					$methods = is_array($found) ? array_values($found) : null;
				}
			}
			if (method_exists($ssh, 'disconnect')) {
				@$ssh->disconnect();
			}
			return $keys;
		} catch (\Throwable $e) {
			$this->logger->debug('NetBase: SSH host key probe failed', ['exception' => $e]);
			return [];
		}
	}

	private function hostKeyBits(string $type, string $raw): ?int {
		return match (true) {
			str_contains($type, 'ed25519') => 256,
			str_contains($type, 'ecdsa') && str_contains($type, '256') => 256,
			str_contains($type, 'ecdsa') && str_contains($type, '384') => 384,
			str_contains($type, 'ecdsa') && str_contains($type, '521') => 521,
			str_contains($type, 'rsa') => $this->rsaBits($raw),
			default => null,
		};
	}

	private function rsaBits(string $raw): ?int {
		// ssh-rsa blob: string "ssh-rsa", mpint e, mpint n — the modulus length
		// is the key size.
		$offset = 0;
		$fields = [];
		while ($offset + 4 <= strlen($raw) && count($fields) < 3) {
			$size = unpack('N', substr($raw, $offset, 4))[1] ?? 0;
			$offset += 4;
			$fields[] = substr($raw, $offset, $size);
			$offset += $size;
		}
		if (count($fields) < 3) {
			return null;
		}
		$modulus = ltrim($fields[2], "\0");
		return strlen($modulus) * 8;
	}

	/** @return array<int, array<string, mixed>> */
	private function sshFindings(array $probe): array {
		$findings = [];
		if (!$probe['ok']) {
			return [$this->finding('bad', 'SSH', (string)($probe['error'] ?? 'No answer'))];
		}
		$protocol = (string)($probe['protocol'] ?? '');
		if (str_starts_with($protocol, '1.')) {
			$findings[] = $this->finding('bad', 'Protocol', $this->l->t('The server still offers SSH protocol 1, which is broken. Disable it.'));
		}
		$weak = [];
		foreach (['kex', 'hostKey', 'encryptionClientToServer', 'macClientToServer'] as $group) {
			foreach ($probe['algorithms'][$group] ?? [] as $algorithm) {
				$name = strtolower(explode('@', $algorithm)[0]);
				if (isset(self::WEAK[$name])) {
					$weak[$name] = self::WEAK[$name];
				}
			}
		}
		foreach ($weak as $name => $why) {
			$findings[] = $this->finding('warn', 'Algorithms', $this->l->t('%s is still offered (%s).', [$name, $this->l->t($why)]));
		}
		if ($weak === []) {
			$findings[] = $this->finding('ok', 'Algorithms', $this->l->t('No obviously outdated key exchange, cipher or MAC is offered.'));
		}
		foreach ($probe['hostKeys'] ?? [] as $key) {
			if (($key['type'] ?? '') === 'ssh-rsa' && is_int($key['bits'] ?? null) && $key['bits'] < 2048) {
				$findings[] = $this->finding('bad', 'Host key', $this->l->t('The RSA host key is only %d bits.', [$key['bits']]));
			}
		}
		if (($probe['software'] ?? '') !== '') {
			$findings[] = $this->finding('info', 'Version', $this->l->t('The banner names the software: %s. Hiding it is cosmetic, but some auditors ask for it.', [$probe['software']]));
		}
		return $findings;
	}

	// ------------------------------------------------------------------ Telnet

	/**
	 * Telnet, which should not be running at all in most places: this reads the
	 * login screen (answering the option negotiation politely) so you can see
	 * which device it is.
	 *
	 * @return array<string, mixed>
	 */
	public function telnet(string $host, int $port = 23, float $timeout = 6.0): array {
		$host = $this->tools->validateHost($host);
		$port = max(1, min(65535, $port));
		$errno = 0;
		$errstr = '';
		$target = str_contains($host, ':') && filter_var($host, FILTER_VALIDATE_IP) !== false ? '[' . $host . ']' : $host;
		$stream = @stream_socket_client('tcp://' . $target . ':' . $port, $errno, $errstr, $timeout);
		if ($stream === false) {
			return ['host' => $host, 'port' => $port, 'ok' => false, 'error' => $errstr ?: 'Could not connect', 'findings' => []];
		}
		stream_set_timeout($stream, 3);

		$text = '';
		$options = [];
		$deadline = microtime(true) + min(5.0, $timeout);
		while (microtime(true) < $deadline && strlen($text) < 4096) {
			$chunk = @fread($stream, 1024);
			if ($chunk === false || $chunk === '') {
				break;
			}
			$reply = '';
			$length = strlen($chunk);
			for ($i = 0; $i < $length; $i++) {
				if (ord($chunk[$i]) !== 255 || $i + 2 >= $length) { // IAC
					$text .= $chunk[$i];
					continue;
				}
				$verb = ord($chunk[$i + 1]);
				$option = ord($chunk[$i + 2]);
				$options[] = ['verb' => $verb, 'option' => $option];
				// Refuse everything: DO -> WONT, WILL -> DONT. That keeps the
				// server talking without pretending to be a terminal.
				if ($verb === 253) {
					$reply .= chr(255) . chr(252) . chr($option);
				} elseif ($verb === 251) {
					$reply .= chr(255) . chr(254) . chr($option);
				}
				$i += 2;
			}
			if ($reply !== '') {
				@fwrite($stream, $reply);
			}
			if (preg_match('/(login|user ?name|password)\s*:\s*$/i', $text)) {
				break;
			}
		}
		@fclose($stream);

		$clean = trim(preg_replace('/[^\P{C}\n\r\t]+/u', '', $text) ?? $text);
		return [
			'host' => $host, 'port' => $port, 'ok' => true,
			'banner' => mb_substr($clean, 0, 2000),
			'negotiations' => count($options),
			'findings' => [
				$this->finding('bad', 'Telnet', $this->l->t('Telnet is open. Everything typed over it, passwords included, crosses the network in plain text — replace it with SSH where you can.')),
			],
		];
	}

	// ------------------------------------------------------------------ NTP

	/**
	 * Ask an NTP server for the time and report the offset against this server's
	 * clock — the usual explanation for expired-certificate and login errors.
	 *
	 * @return array<string, mixed>
	 */
	public function ntp(string $host, float $timeout = 4.0): array {
		$host = $this->tools->validateHost($host);
		$packet = chr(0x1b) . str_repeat("\0", 47);
		$errno = 0;
		$errstr = '';
		$socket = @stream_socket_client('udp://' . $host . ':123', $errno, $errstr, $timeout);
		if ($socket === false) {
			return ['host' => $host, 'ok' => false, 'error' => $errstr ?: 'Could not reach the server'];
		}
		stream_set_timeout($socket, (int)$timeout);
		$sent = microtime(true);
		@fwrite($socket, $packet);
		$response = @fread($socket, 48);
		$received = microtime(true);
		@fclose($socket);
		if (!is_string($response) || strlen($response) < 48) {
			return ['host' => $host, 'ok' => false, 'error' => 'No answer from the time server'];
		}

		$fields = unpack('C4head/Nroot_delay/Nroot_dispersion/a4ref_id/Nref_ts/Nref_frac/Norig_ts/Norig_frac/Nrecv_ts/Nrecv_frac/Ntx_ts/Ntx_frac', $response);
		// NTP counts seconds from 1900; Unix counts from 1970.
		$serverTime = ($fields['tx_ts'] ?? 0) - 2208988800 + (($fields['tx_frac'] ?? 0) / 4294967296);
		$roundTrip = $received - $sent;
		$offset = $serverTime - ($received - $roundTrip / 2);
		$stratum = $fields['head2'] ?? 0;
		return [
			'host' => $host, 'ok' => true,
			'serverTime' => round($serverTime, 3),
			'localTime' => round($received, 3),
			'offsetSeconds' => round($offset, 3),
			'roundTripMs' => round($roundTrip * 1000, 2),
			'stratum' => $stratum,
			'findings' => [abs($offset) > 5
				? $this->finding('bad', 'Clock', $this->l->t('This server\'s clock differs from %s by %.1f seconds. Expect certificate and sign-in failures.', [$host, $offset]))
				: (abs($offset) > 0.5
					? $this->finding('warn', 'Clock', $this->l->t('Clock offset %.2f seconds against %s.', [$offset, $host]))
					: $this->finding('ok', 'Clock', $this->l->t('Clock is within %.3f seconds of %s.', [$offset, $host])))],
		];
	}

	/** @return array<string, string> */
	private function finding(string $level, string $area, string $text): array {
		return ['level' => $level, 'area' => $area, 'text' => $text];
	}
}
