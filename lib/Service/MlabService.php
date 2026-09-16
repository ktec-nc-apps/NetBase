<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use Psr\Log\LoggerInterface;

/**
 * The speed test the rest of the world already uses.
 *
 * The measurement behind Google's own "internet speed test" is M-Lab's NDT7,
 * and it is open: a request to their locate service names the nearest servers
 * and hands back URLs that already carry the short-lived token they need. No
 * account, no key, nothing to register.
 *
 * What it costs is that the measurement is not an HTTP download — it is a
 * WebSocket, and PHP has no client for one. So the handshake and the framing
 * are written out here by hand. That is less daunting than it sounds: the
 * handshake is an ordinary HTTP request with an Upgrade header, and a frame is
 * two bytes of header, sometimes a longer length, and then the payload. The
 * only rule easy to get wrong is that a client must mask what it sends and a
 * server must not — so the two directions are not symmetrical.
 *
 * Why bother, when an HTTP download already worked: the old test pulled from
 * one fixed endpoint. This asks where the nearest measurement server is and
 * uses that, which is the difference between measuring the line and measuring
 * the distance to somebody else's CDN. It also reports what the far end saw —
 * its own byte count and round-trip time — so the two can be compared instead
 * of taken on faith.
 */
class MlabService {
	/** Where to ask which servers are near. Public, and needs no credentials. */
	private const LOCATE = 'https://locate.measurementlab.net/v2/nearest/ndt/ndt7';

	/** The subprotocol name NDT7 servers expect; without it they refuse. */
	private const SUBPROTOCOL = 'net.measurementlab.ndt.v7';

	/** NDT7 runs for ten seconds in each direction by design. */
	private const RUN_SECONDS = 10.0;

	/** How long to wait for the locate service and for the handshake. */
	private const SETUP_TIMEOUT = 12.0;

	/** A sample every tenth of a second: enough to draw, not enough to drown. */
	private const SAMPLE_EVERY = 0.1;

	/**
	 * The shortest run worth believing.
	 *
	 * A byte cap on its own can end an upload before it has begun: the first few
	 * megabytes go into the socket buffer at memory speed, so a run that stops
	 * there reports the speed of the buffer rather than of the line — which is
	 * how a 5 MB upload came out faster than the download. Two seconds is long
	 * enough for the buffer to stop mattering.
	 */
	private const MIN_SECONDS = 2.0;

	/** What one sent frame carries. Big enough to fill a fast line, small
	 *  enough that the byte cap is never overshot by much. */
	private const SEND_CHUNK = 262144;

	public function __construct(
		private LoggerInterface $logger,
	) {
	}

	/** Whether this PHP can speak to a measurement server at all. */
	public function available(): bool {
		return extension_loaded('openssl') && function_exists('stream_socket_client');
	}

	/**
	 * The measurement servers nearest to this machine.
	 *
	 * @return list<array{machine: string, city: string, country: string, download: string, upload: string}>
	 */
	public function servers(): array {
		$context = stream_context_create(['http' => [
			'method' => 'GET',
			'timeout' => self::SETUP_TIMEOUT,
			'header' => "User-Agent: NetBase (Nextcloud)\r\nAccept: application/json\r\n",
			'ignore_errors' => true,
		]]);
		$body = @file_get_contents(self::LOCATE, false, $context);
		if ($body === false) {
			return [];
		}
		$answer = json_decode($body, true);
		if (!is_array($answer) || empty($answer['results'])) {
			return [];
		}
		$out = [];
		foreach ($answer['results'] as $result) {
			$urls = (array)($result['urls'] ?? []);
			$download = '';
			$upload = '';
			foreach ($urls as $key => $url) {
				if (!str_starts_with((string)$key, 'wss')) {
					continue;
				}
				if (str_contains((string)$key, 'download')) {
					$download = (string)$url;
				} elseif (str_contains((string)$key, 'upload')) {
					$upload = (string)$url;
				}
			}
			if ($download === '') {
				continue;
			}
			$location = (array)($result['location'] ?? []);
			$out[] = [
				'machine' => (string)($result['machine'] ?? ''),
				'city' => (string)($location['city'] ?? ''),
				'country' => (string)($location['country'] ?? ''),
				'download' => $download,
				'upload' => $upload,
			];
		}
		return $out;
	}

	/**
	 * The quickest of the servers offered, by actually asking them.
	 *
	 * The locate service returns its candidates in its own order, worked out
	 * from the address the request came from. That is a guess about geography,
	 * and it is sometimes wrong in a way that matters: this server was handed
	 * Seoul ahead of Tokyo, and a measurement to the wrong country reads as a
	 * slow line rather than a distant one.
	 *
	 * So the first few are asked directly — one TCP connection each, timed. It
	 * costs a fraction of a second and replaces a guess with a measurement. If
	 * none of them answers, the locate service's own first choice stands.
	 *
	 * @param list<array<string, mixed>> $servers
	 * @return array<string, mixed>|null
	 */
	public function nearest(array $servers, int $probe = 4): ?array {
		if ($servers === []) {
			return null;
		}
		$best = null;
		$bestMs = null;
		foreach (array_slice($servers, 0, max(1, $probe)) as $server) {
			$host = (string)parse_url((string)($server['download'] ?? ''), PHP_URL_HOST);
			if ($host === '') {
				continue;
			}
			$started = microtime(true);
			$socket = @stream_socket_client(
				'tcp://' . $host . ':443',
				$errno,
				$errstr,
				1.5,
				STREAM_CLIENT_CONNECT,
			);
			if (!is_resource($socket)) {
				continue;
			}
			$ms = (microtime(true) - $started) * 1000;
			fclose($socket);
			if ($bestMs === null || $ms < $bestMs) {
				$bestMs = $ms;
				$best = $server + ['probeMs' => round($ms, 1)];
			}
		}
		return $best ?? $servers[0];
	}

	/**
	 * Measure one direction.
	 *
	 * $emit is handed a reading roughly ten times a second and returns false
	 * once the browser has gone, which ends the measurement there and then —
	 * there is no point finishing a test nobody is waiting for.
	 *
	 * @param 'download'|'upload' $direction
	 * @param callable(int, float): bool $emit bytes so far, seconds so far
	 * @return array{bytes: int, seconds: float, mbps: float, server: array<string, mixed>, remote: array<string, mixed>|null, error: string|null}
	 */
	public function measure(string $direction, array $server, float $seconds, int $maxBytes, callable $emit): array {
		$empty = ['bytes' => 0, 'seconds' => 0.0, 'mbps' => 0.0, 'server' => $server, 'remote' => null];
		$url = (string)($server[$direction === 'upload' ? 'upload' : 'download'] ?? '');
		if ($url === '') {
			return $empty + ['error' => 'That measurement server offers no ' . $direction];
		}
		$stream = $this->open($url, $error);
		if ($stream === null) {
			return $empty + ['error' => $error];
		}

		$seconds = max(1.0, min(self::RUN_SECONDS, $seconds));
		$deadline = microtime(true) + $seconds;
		$started = microtime(true);
		$carried = 0;
		$lastSample = 0.0;
		$remote = null;
		$live = true;
		$lastPoll = 0.0;
		$payload = $direction === 'upload' ? random_bytes(self::SEND_CHUNK) : '';

		try {
			while (microtime(true) < $deadline) {
				if ($direction === 'upload') {
					// A client frame has to be masked; the payload is noise,
					// because what is being measured is the line, not the data.
					// It is made once: drawing a quarter of a megabyte of
					// randomness on every frame costs more than the send does.
					if (!$this->send($stream, $payload)) {
						break;
					}
					$carried += strlen($payload);
					// The far end talks back while we send, but asking after
					// every frame is what throttles the sending: each poll cost
					// tens of milliseconds, which at this frame size put a
					// ceiling on the line far below its real speed. So it is
					// asked a couple of times a second, and never waited for.
					$now = microtime(true);
					if ($now - $lastPoll >= 0.5) {
						$lastPoll = $now;
						$frame = $this->receive($stream, 0.0);
						if ($frame !== null && $frame['text'] && $frame['payload'] !== '') {
							$decoded = json_decode($frame['payload'], true);
							if (is_array($decoded)) {
								$remote = $decoded;
							}
						}
					}
				} else {
					$frame = $this->receive($stream, 1.0);
					if ($frame === null) {
						break;
					}
					$carried += $frame['bytes'];
					if ($frame['text'] && $frame['payload'] !== '') {
						$decoded = json_decode($frame['payload'], true);
						if (is_array($decoded)) {
							$remote = $decoded;
						}
					}
				}
				// The cap ends the run, but never before the measurement has had
				// long enough to mean anything.
				if ($maxBytes > 0 && $carried >= $maxBytes
					&& (microtime(true) - $started) >= self::MIN_SECONDS) {
					break;
				}
				$now = microtime(true);
				if ($now - $lastSample >= self::SAMPLE_EVERY) {
					$lastSample = $now;
					$live = $emit($carried, $now - $started);
					if (!$live) {
						break;
					}
				}
			}
		} catch (\Throwable $e) {
			$this->logger->debug('NetBase: the measurement ended early', ['exception' => $e, 'app' => 'netbase']);
		} finally {
			@fclose($stream);
		}

		$elapsed = max(0.001, microtime(true) - $started);
		return [
			'bytes' => $carried,
			'seconds' => round($elapsed, 3),
			'mbps' => round($carried * 8 / $elapsed / 1000000, 2),
			'server' => $server,
			'remote' => $remote,
			'error' => $carried > 0 ? null : 'No data passed',
		];
	}

	/** What the far end said about the connection, in plain numbers. */
	public function remoteView(?array $remote, string $direction = 'download'): ?array {
		$tcp = is_array($remote) ? (array)($remote['TCPInfo'] ?? []) : [];
		if ($tcp === []) {
			return null;
		}
		$elapsed = (float)($tcp['ElapsedTime'] ?? 0);
		$acked = (float)($tcp['BytesAcked'] ?? 0);
		// BytesAcked counts what the far end sent and had acknowledged. During
		// an upload it is sending almost nothing, so quoting that figure as a
		// speed would report a fraction of a megabit and look like a fault.
		// The round trip it measures is worth having in both directions.
		return [
			'mbps' => ($direction === 'download' && $elapsed > 0) ? round($acked * 8 / $elapsed, 2) : null,
			'minRttMs' => isset($tcp['MinRTT']) ? round((float)$tcp['MinRTT'] / 1000, 1) : null,
			'rttMs' => isset($tcp['RTT']) ? round((float)$tcp['RTT'] / 1000, 1) : null,
			'retransmits' => isset($tcp['BytesRetrans']) ? (int)$tcp['BytesRetrans'] : null,
		];
	}

	// ---------------------------------------------------------------- the wire

	/**
	 * Open the measurement channel: a TLS connection, then the handshake that
	 * turns it from HTTP into a WebSocket.
	 *
	 * @param-out string|null $error
	 * @return resource|null
	 */
	private function open(string $url, ?string &$error) {
		$parts = parse_url($url);
		$host = (string)($parts['host'] ?? '');
		if ($host === '') {
			$error = 'The measurement server gave an address that could not be read';
			return null;
		}
		$port = (int)($parts['port'] ?? 443);
		$path = (string)($parts['path'] ?? '/') . (isset($parts['query']) ? '?' . $parts['query'] : '');

		$context = stream_context_create(['ssl' => [
			'peer_name' => $host,
			'verify_peer' => true,
			'verify_peer_name' => true,
		]]);
		$stream = @stream_socket_client(
			'ssl://' . $host . ':' . $port,
			$number,
			$message,
			self::SETUP_TIMEOUT,
			STREAM_CLIENT_CONNECT,
			$context,
		);
		if (!is_resource($stream)) {
			$error = 'Could not reach the measurement server: ' . ($message ?: 'no answer');
			return null;
		}
		stream_set_timeout($stream, (int)self::SETUP_TIMEOUT);

		// The handshake is an ordinary request; the key is a nonce, and the
		// server's answer to it is not checked here because the connection is
		// already authenticated by TLS and the token in the URL.
		$key = base64_encode(random_bytes(16));
		$request = "GET {$path} HTTP/1.1\r\n"
			. "Host: {$host}\r\n"
			. "Upgrade: websocket\r\n"
			. "Connection: Upgrade\r\n"
			. "Sec-WebSocket-Key: {$key}\r\n"
			. "Sec-WebSocket-Version: 13\r\n"
			. 'Sec-WebSocket-Protocol: ' . self::SUBPROTOCOL . "\r\n"
			. "User-Agent: NetBase (Nextcloud)\r\n\r\n";
		if (@fwrite($stream, $request) === false) {
			@fclose($stream);
			$error = 'The measurement server closed the connection during the handshake';
			return null;
		}

		$head = '';
		while (!str_contains($head, "\r\n\r\n") && strlen($head) < 8192) {
			$chunk = @fread($stream, 1024);
			if ($chunk === false || $chunk === '') {
				break;
			}
			$head .= $chunk;
		}
		$status = strtok($head, "\r\n") ?: '';
		if (!str_contains($status, '101')) {
			@fclose($stream);
			$error = 'The measurement server refused the connection: ' . ($status ?: 'no answer');
			return null;
		}
		// Whatever arrived after the headers is already measurement data.
		$rest = explode("\r\n\r\n", $head, 2)[1] ?? '';
		$this->spare = $rest;
		stream_set_blocking($stream, false);
		$error = null;
		return $stream;
	}

	/** Bytes read past the end of the handshake, kept for the first frame. */
	private string $spare = '';

	/**
	 * One frame from the far end, or null when nothing came in time.
	 *
	 * @param resource $stream
	 * @return array{bytes: int, text: bool, payload: string}|null
	 */
	private function receive($stream, float $wait): ?array {
		$header = $this->take($stream, 2, $wait);
		if ($header === null) {
			return null;
		}
		$first = ord($header[0]);
		$second = ord($header[1]);
		$opcode = $first & 0x0F;
		$masked = ($second & 0x80) !== 0;
		$length = $second & 0x7F;
		$overhead = 2;

		if ($length === 126) {
			$more = $this->take($stream, 2, 1.0);
			if ($more === null) {
				return null;
			}
			$length = unpack('n', $more)[1];
			$overhead += 2;
		} elseif ($length === 127) {
			$more = $this->take($stream, 8, 1.0);
			if ($more === null) {
				return null;
			}
			$parts = unpack('N2', $more);
			$length = ($parts[1] << 32) | $parts[2];
			$overhead += 8;
		}
		// A server must not mask, but a stray mask must not be misread as data.
		if ($masked) {
			$mask = $this->take($stream, 4, 1.0);
			if ($mask === null) {
				return null;
			}
			$overhead += 4;
		}
		$payload = $length > 0 ? $this->take($stream, $length, 2.0) : '';
		if ($payload === null) {
			return null;
		}
		if ($opcode === 0x8) {
			return null;
		}
		return ['bytes' => $overhead + $length, 'text' => $opcode === 0x1, 'payload' => $payload];
	}

	/**
	 * Exactly $want bytes, or null if they do not arrive in time.
	 *
	 * @param resource $stream
	 */
	private function take($stream, int $want, float $wait): ?string {
		// A wait of zero is a glance, not a pause: the sending path uses it to
		// pick up anything already waiting without giving up its turn.
		$micros = $wait <= 0.0 ? 0 : 100000;
		$deadline = microtime(true) + ($wait <= 0.0 ? 0.0 : max(0.05, $wait));
		while (strlen($this->spare) < $want) {
			if (microtime(true) > $deadline) {
				return null;
			}
			$read = [$stream];
			$write = null;
			$except = null;
			if (@stream_select($read, $write, $except, 0, $micros) === false) {
				return null;
			}
			$chunk = @fread($stream, 65536);
			if ($chunk === false) {
				return null;
			}
			if ($chunk === '') {
				if (feof($stream)) {
					return null;
				}
				continue;
			}
			$this->spare .= $chunk;
		}
		$out = substr($this->spare, 0, $want);
		$this->spare = substr($this->spare, $want);
		return $out;
	}

	/**
	 * Send one binary frame. A client masks what it sends — that is not a
	 * security measure, it is what the protocol requires of this side.
	 *
	 * @param resource $stream
	 */
	private function send($stream, string $payload): bool {
		$length = strlen($payload);
		$header = chr(0x82); // final frame, binary
		if ($length < 126) {
			$header .= chr(0x80 | $length);
		} elseif ($length < 65536) {
			$header .= chr(0x80 | 126) . pack('n', $length);
		} else {
			$header .= chr(0x80 | 127) . pack('N2', 0, $length);
		}
		$mask = random_bytes(4);
		$header .= $mask;
		$masked = $payload ^ str_repeat($mask, (int)ceil($length / 4));
		$frame = $header . substr($masked, 0, $length);

		$sent = 0;
		$total = strlen($frame);
		$deadline = microtime(true) + 5.0;
		while ($sent < $total) {
			if (microtime(true) > $deadline) {
				return false;
			}
			$wrote = @fwrite($stream, substr($frame, $sent));
			if ($wrote === false) {
				return false;
			}
			if ($wrote === 0) {
				$read = null;
				$write = [$stream];
				$except = null;
				if (@stream_select($read, $write, $except, 0, 100000) === false) {
					return false;
				}
				continue;
			}
			$sent += $wrote;
		}
		return true;
	}
}
