<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * Measurements rather than lookups: how fast the link is, how quickly
 * resolvers answer, where the time goes in an HTTP request.
 *
 * Most of this needs nothing beyond a stock PHP: interface counters come from
 * the kernel, DNS timings are measured with datagrams we build ourselves, and
 * HTTP and throughput use ext-curl. Only the LAN throughput test needs an
 * external program (iperf3), and its absence is reported rather than fatal.
 */
class BenchmarkService {
	/** Public resolvers offered alongside whatever this server already uses. */
	public const PUBLIC_RESOLVERS = [
		'1.1.1.1' => 'Cloudflare',
		'8.8.8.8' => 'Google',
		'9.9.9.9' => 'Quad9',
		'208.67.222.222' => 'OpenDNS',
		'1.0.0.1' => 'Cloudflare (secondary)',
		'8.8.4.4' => 'Google (secondary)',
	];

	/** Names used for resolver timing — spread across operators on purpose. */
	private const PROBE_DOMAINS = ['nextcloud.com', 'wikipedia.org', 'github.com', 'cloudflare.com', 'apple.com'];

	/**
	 * Where a measurement may be taken.
	 *
	 * M-Lab names the server nearest to this machine, so it is what 'auto'
	 * reaches for; Cloudflare is one fixed endpoint, reachable from places
	 * M-Lab's WebSocket is not. Either can be named outright, because a
	 * network that reaches one may not reach the other, and because the two
	 * do not always agree about the same line.
	 */
	public const VIA_AUTO = 'auto';
	public const VIA_MLAB = 'mlab';
	public const VIA_CLOUDFLARE = 'cloudflare';

	public function __construct(
		private ExecService $exec,
		private DiscoveryService $discovery,
		private L10nService $l,
		private MlabService $mlab,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	// ---------------------------------------------------------------- interfaces

	/**
	 * Byte and packet counters straight from the kernel.
	 *
	 * The browser polls this and differentiates it, which is why a timestamp
	 * travels with the numbers: without it the rate would be guesswork
	 * whenever a request is delayed.
	 *
	 * @return array{at: float, interfaces: array<string, array{rx: int, tx: int, rxPackets: int, txPackets: int, rxErrors: int, txErrors: int, rxDropped: int, txDropped: int}>}
	 */
	public function interfaceCounters(): array {
		$out = [];
		$lines = @file('/proc/net/dev') ?: [];
		foreach (array_slice($lines, 2) as $line) {
			[$name, $rest] = array_pad(explode(':', $line, 2), 2, '');
			$name = trim($name);
			$fields = preg_split('/\s+/', trim((string)$rest)) ?: [];
			if ($name === '' || count($fields) < 16) {
				continue;
			}
			$out[$name] = [
				'rx' => (int)$fields[0],
				'rxPackets' => (int)$fields[1],
				'rxErrors' => (int)$fields[2],
				'rxDropped' => (int)$fields[3],
				'tx' => (int)$fields[8],
				'txPackets' => (int)$fields[9],
				'txErrors' => (int)$fields[10],
				'txDropped' => (int)$fields[11],
			];
		}
		return ['at' => microtime(true), 'interfaces' => $out];
	}

	// ---------------------------------------------------------------- dns timing

	/**
	 * Time several resolvers over the same set of names.
	 *
	 * Queries are built here and sent as plain datagrams, so the measurement
	 * is of the resolver rather than of PHP's own resolver cache.
	 *
	 * @param list<string> $resolvers
	 * @return array{resolvers: list<array>, fastest: ?string, domains: list<string>}
	 */
	public function dnsBenchmark(array $resolvers = [], int $rounds = 2): array {
		$resolvers = array_values(array_filter($resolvers, static fn ($ip) => filter_var($ip, FILTER_VALIDATE_IP) !== false));
		if ($resolvers === []) {
			$resolvers = array_merge($this->systemResolvers(), array_keys(self::PUBLIC_RESOLVERS));
			$resolvers = array_values(array_unique($resolvers));
		}
		$rounds = max(1, min(5, $rounds));

		$results = [];
		foreach (array_slice($resolvers, 0, 12) as $resolver) {
			$samples = [];
			$failures = 0;
			for ($round = 0; $round < $rounds; $round++) {
				foreach (self::PROBE_DOMAINS as $domain) {
					$ms = $this->timeDnsQuery($resolver, $domain);
					if ($ms === null) {
						$failures++;
					} else {
						$samples[] = $ms;
					}
				}
			}
			sort($samples);
			$count = count($samples);
			$results[] = [
				'resolver' => $resolver,
				'name' => $this->resolverName($resolver),
				'queries' => $count + $failures,
				'answered' => $count,
				'failed' => $failures,
				'min' => $count ? round($samples[0], 1) : null,
				'median' => $count ? round($samples[intdiv($count, 2)], 1) : null,
				'avg' => $count ? round(array_sum($samples) / $count, 1) : null,
				'max' => $count ? round($samples[$count - 1], 1) : null,
				'jitter' => $count > 1 ? round($this->stdDev($samples), 1) : null,
			];
		}

		usort($results, static function ($a, $b) {
			if ($a['median'] === null) {
				return 1;
			}
			if ($b['median'] === null) {
				return -1;
			}
			return $a['median'] <=> $b['median'];
		});

		return [
			'resolvers' => $results,
			'fastest' => $results[0]['median'] !== null ? $results[0]['resolver'] : null,
			'domains' => self::PROBE_DOMAINS,
		];
	}

	/** One A-record query, timed. Returns milliseconds, or null on timeout. */
	private function timeDnsQuery(string $resolver, string $domain, float $timeout = 2.0): ?float {
		$id = random_bytes(2);
		$qname = '';
		foreach (explode('.', $domain) as $label) {
			$qname .= chr(strlen($label)) . $label;
		}
		$qname .= "\x00";
		$packet = $id . "\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00" . $qname . "\x00\x01\x00\x01";

		$target = str_contains($resolver, ':') ? '[' . $resolver . ']' : $resolver;
		$sock = @stream_socket_client('udp://' . $target . ':53', $errno, $errstr, $timeout);
		if ($sock === false) {
			return null;
		}
		stream_set_timeout($sock, (int)$timeout, (int)(fmod($timeout, 1) * 1_000_000));
		$started = microtime(true);
		@fwrite($sock, $packet);
		$answer = @fread($sock, 4096);
		$elapsed = (microtime(true) - $started) * 1000;
		@fclose($sock);

		// A reply that is not ours (or no reply at all) is not a measurement.
		if (!is_string($answer) || strlen($answer) < 4 || substr($answer, 0, 2) !== $id) {
			return null;
		}
		return $elapsed;
	}

	/** @return list<string> */
	public function systemResolvers(): array {
		$out = [];
		foreach (@file('/etc/resolv.conf') ?: [] as $line) {
			if (preg_match('/^\s*nameserver\s+(\S+)/', $line, $m) && filter_var($m[1], FILTER_VALIDATE_IP)) {
				$out[] = $m[1];
			}
		}
		return $out;
	}

	private function resolverName(string $ip): string {
		if (isset(self::PUBLIC_RESOLVERS[$ip])) {
			return self::PUBLIC_RESOLVERS[$ip];
		}
		return in_array($ip, $this->systemResolvers(), true) ? 'This server’s resolver' : '';
	}

	// ---------------------------------------------------------------- throughput

	/**
	 * Download and upload throughput against an HTTP endpoint.
	 *
	 * This necessarily sends traffic to whichever service is configured, so
	 * the endpoint is a setting and the app names it in the interface before
	 * anything is transferred.
	 *
	 * @return array{download: ?array, upload: ?array, latency: ?array, endpoint: string}
	 */
	/**
	 * The same measurement, but reported while it happens.
	 *
	 * A speed test that only gives its answer at the end tells you the average
	 * and hides everything interesting — the ramp-up, a stall, a line that
	 * fades under load. cURL calls back many times a second during a transfer,
	 * so each call is a chance to say how far along it is; $emit is handed one
	 * sample at a time and returns false once the browser has gone.
	 *
	 * What is measured is unchanged: this server's own line, not the browser's.
	 *
	 * @param callable(array): bool $emit
	 */
	private function cloudflareStream(int $megabytes, bool $upload, callable $emit): void {
		if (!function_exists('curl_init')) {
			$emit(['phase' => 'error', 'error' => 'The PHP cURL extension is required for the speed test']);
			return;
		}
		$megabytes = max(1, min(200, $megabytes));
		$bytes = $megabytes * 1000000;
		$downUrl = $this->config->getAppValue('netbase', 'speedtest_down', 'https://speed.cloudflare.com/__down?bytes=');
		$upUrl = $this->config->getAppValue('netbase', 'speedtest_up', 'https://speed.cloudflare.com/__up');

		// Say something at once. Measuring the latency takes a few seconds, and
		// without this the browser would sit silent through all of it.
		if (!$emit(['phase' => 'start', 'megabytes' => $megabytes, 'upload' => $upload])) {
			return;
		}
		$latency = $this->httpLatency($downUrl . '1000');
		if (!$emit(['phase' => 'latency', 'latency' => $latency])) {
			return;
		}

		// The same cap as the one-shot test: this endpoint refuses 100 MB.
		$downBytes = str_contains($downUrl, 'speed.cloudflare.com') ? min($bytes, 99999999) : $bytes;
		$alive = true;
		$started = microtime(true);
		$carried = 0;
		$lastSent = 0.0;

		$curl = curl_init($downUrl . $downBytes);
		curl_setopt_array($curl, [
			CURLOPT_RETURNTRANSFER => false,
			CURLOPT_WRITEFUNCTION => function ($handle, string $chunk) use (&$alive, &$carried, &$lastSent, $started, $emit): int {
				$carried += strlen($chunk);
				$now = microtime(true);
				// One sample every tenth of a second: often enough to draw a
				// line, seldom enough not to drown the browser in them.
				if ($now - $lastSent >= 0.1) {
					$lastSent = $now;
					$seconds = max(0.001, $now - $started);
					$alive = $emit([
						'phase' => 'down',
						'bytes' => $carried,
						'seconds' => round($seconds, 3),
						'mbps' => round($carried * 8 / $seconds / 1000000, 2),
					]);
				}
				return $alive ? strlen($chunk) : 0;
			},
			CURLOPT_TIMEOUT => 120,
			CURLOPT_CONNECTTIMEOUT => 15,
			CURLOPT_USERAGENT => 'NetBase (Nextcloud)',
			CURLOPT_ENCODING => 'identity',
			CURLOPT_FAILONERROR => true,
		]);
		$ok = curl_exec($curl);
		$download = $ok === false && $alive ? null : [
			'bytes' => (int)curl_getinfo($curl, CURLINFO_SIZE_DOWNLOAD),
			'seconds' => round((float)curl_getinfo($curl, CURLINFO_TOTAL_TIME) - (float)curl_getinfo($curl, CURLINFO_PRETRANSFER_TIME), 3),
			'mbps' => round((float)curl_getinfo($curl, CURLINFO_SPEED_DOWNLOAD) * 8 / 1000000, 2),
		];
		$downloadError = ($ok === false && $alive) ? curl_error($curl) : null;
		curl_close($curl);
		if (!$alive) {
			return;
		}
		if (!$emit(['phase' => 'downDone', 'download' => $download, 'error' => $downloadError])) {
			return;
		}

		$uploadResult = null;
		$uploadError = null;
		if ($upload) {
			$payload = str_repeat('0', min($bytes, 25000000));
			$upStarted = microtime(true);
			$lastSent = 0.0;
			$curl = curl_init($upUrl);
			curl_setopt_array($curl, [
				CURLOPT_POST => true,
				CURLOPT_POSTFIELDS => $payload,
				CURLOPT_RETURNTRANSFER => true,
				CURLOPT_TIMEOUT => 120,
				CURLOPT_CONNECTTIMEOUT => 15,
				CURLOPT_USERAGENT => 'NetBase (Nextcloud)',
				CURLOPT_HTTPHEADER => ['Content-Type: application/octet-stream', 'Expect:'],
				CURLOPT_FAILONERROR => true,
				// Sending is one call with the whole body, so there is no write
				// callback to count it; this is where the far end reports back.
				CURLOPT_NOPROGRESS => false,
				CURLOPT_XFERINFOFUNCTION => function ($handle, $downTotal, $downNow, $upTotal, $upNow) use (&$alive, &$lastSent, $upStarted, $emit): int {
					$now = microtime(true);
					if ($upNow > 0 && $now - $lastSent >= 0.1) {
						$lastSent = $now;
						$seconds = max(0.001, $now - $upStarted);
						$alive = $emit([
							'phase' => 'up',
							'bytes' => (int)$upNow,
							'seconds' => round($seconds, 3),
							'mbps' => round($upNow * 8 / $seconds / 1000000, 2),
						]);
					}
					return $alive ? 0 : 1;
				},
			]);
			$ok = curl_exec($curl);
			$uploadResult = ($ok === false && $alive) ? null : [
				'bytes' => (int)curl_getinfo($curl, CURLINFO_SIZE_UPLOAD),
				'seconds' => round((float)curl_getinfo($curl, CURLINFO_TOTAL_TIME) - (float)curl_getinfo($curl, CURLINFO_PRETRANSFER_TIME), 3),
				'mbps' => round((float)curl_getinfo($curl, CURLINFO_SPEED_UPLOAD) * 8 / 1000000, 2),
			];
			$uploadError = ($ok === false && $alive) ? curl_error($curl) : null;
			curl_close($curl);
			if (!$alive) {
				return;
			}
		}

		$emit([
			'phase' => 'done',
			'endpoint' => parse_url($downUrl, PHP_URL_HOST) ?: 'speed.cloudflare.com',
			'megabytes' => $megabytes,
			'latency' => $latency,
			'download' => $download,
			'downloadError' => $downloadError,
			'upload' => $uploadResult,
			'uploadError' => $uploadError,
		]);
	}

	private function cloudflareTest(int $megabytes = 25, bool $upload = true): array {
		if (!function_exists('curl_init')) {
			throw new \RuntimeException('The PHP cURL extension is required for the speed test');
		}
		$megabytes = max(1, min(200, $megabytes));
		$bytes = $megabytes * 1000000;
		$downUrl = $this->config->getAppValue('netbase', 'speedtest_down', 'https://speed.cloudflare.com/__down?bytes=');
		$upUrl = $this->config->getAppValue('netbase', 'speedtest_up', 'https://speed.cloudflare.com/__up');

		$latency = $this->httpLatency($downUrl . '1000');

		// speed.cloudflare.com's __down endpoint returns HTTP 403 for a request of
		// 100,000,000 bytes or more, so "100 MB" (100 * 1,000,000) failed outright.
		// Cap the download for that endpoint at its limit (a custom endpoint is left as-is).
		$downBytes = str_contains($downUrl, 'speed.cloudflare.com') ? min($bytes, 99999999) : $bytes;
		$curl = curl_init($downUrl . $downBytes);
		curl_setopt_array($curl, [
			CURLOPT_RETURNTRANSFER => false,
			CURLOPT_WRITEFUNCTION => static fn ($ch, $chunk) => strlen($chunk),
			CURLOPT_TIMEOUT => 120,
			CURLOPT_CONNECTTIMEOUT => 15,
			CURLOPT_USERAGENT => 'NetBase (Nextcloud)',
			CURLOPT_ENCODING => 'identity',
			CURLOPT_FAILONERROR => true,
		]);
		$ok = curl_exec($curl);
		$download = $ok === false ? null : [
			'bytes' => (int)curl_getinfo($curl, CURLINFO_SIZE_DOWNLOAD),
			'seconds' => round((float)curl_getinfo($curl, CURLINFO_TOTAL_TIME) - (float)curl_getinfo($curl, CURLINFO_PRETRANSFER_TIME), 3),
			'mbps' => round((float)curl_getinfo($curl, CURLINFO_SPEED_DOWNLOAD) * 8 / 1000000, 2),
		];
		$downloadError = $ok === false ? curl_error($curl) : null;
		curl_close($curl);

		$uploadResult = null;
		$uploadError = null;
		if ($upload) {
			$payload = str_repeat('0', min($bytes, 25000000));
			$curl = curl_init($upUrl);
			curl_setopt_array($curl, [
				CURLOPT_POST => true,
				CURLOPT_POSTFIELDS => $payload,
				CURLOPT_RETURNTRANSFER => true,
				CURLOPT_TIMEOUT => 120,
				CURLOPT_CONNECTTIMEOUT => 15,
				CURLOPT_USERAGENT => 'NetBase (Nextcloud)',
				CURLOPT_HTTPHEADER => ['Content-Type: application/octet-stream', 'Expect:'],
				CURLOPT_FAILONERROR => true,
			]);
			$ok = curl_exec($curl);
			$uploadResult = $ok === false ? null : [
				'bytes' => (int)curl_getinfo($curl, CURLINFO_SIZE_UPLOAD),
				'seconds' => round((float)curl_getinfo($curl, CURLINFO_TOTAL_TIME) - (float)curl_getinfo($curl, CURLINFO_PRETRANSFER_TIME), 3),
				'mbps' => round((float)curl_getinfo($curl, CURLINFO_SPEED_UPLOAD) * 8 / 1000000, 2),
			];
			$uploadError = $ok === false ? curl_error($curl) : null;
			curl_close($curl);
		}

		return [
			'endpoint' => parse_url($downUrl, PHP_URL_HOST) ?: $downUrl,
			'requested' => $megabytes,
			'download' => $download,
			'downloadError' => $downloadError,
			'upload' => $uploadResult,
			'uploadError' => $uploadError,
			'latency' => $latency,
		];
	}

	/**
	 * Measure the line, as the rest of the world measures it.
	 *
	 * The work is done against M-Lab — the measurement behind Google's own
	 * speed test — because it names the nearest server rather than pulling from
	 * one fixed endpoint somewhere. Where that cannot be reached at all (an
	 * instance with no way out, a blocked WebSocket) the older HTTP test still
	 * stands behind it, so the tool never simply stops working.
	 *
	 * @param callable(array): bool $emit returns false once the browser is gone
	 */
	public function speedTestStream(int $megabytes, bool $upload, callable $emit, string $via = 'auto'): void {
		$via = $this->provider($via);
		if ($via === self::VIA_CLOUDFLARE) {
			$this->cloudflareStream($megabytes, $upload, $emit);
			return;
		}
		$servers = $this->mlab->available() ? $this->mlab->servers() : [];
		if ($servers === []) {
			// Named outright, so say it could not be done. Quietly measuring
			// against the other one would hand back a figure the caller would
			// read as M-Lab's.
			if ($via === self::VIA_MLAB) {
				$emit(['phase' => 'error', 'error' => $this->l->t('No M-Lab measurement server could be reached. Choose Cloudflare instead, or let NetBase choose.')]);
				return;
			}
			$this->cloudflareStream($megabytes, $upload, $emit);
			return;
		}
		$this->mlabStream($megabytes, $upload, $emit, $this->mlab->nearest($servers));
	}

	/** The same measurement, reported once at the end. */
	public function speedTest(int $megabytes = 25, bool $upload = true, string $via = 'auto'): array {
		$via = $this->provider($via);
		if ($via === self::VIA_CLOUDFLARE) {
			return $this->cloudflareTest($megabytes, $upload);
		}
		$servers = $this->mlab->available() ? $this->mlab->servers() : [];
		if ($servers !== []) {
			$out = null;
			$this->mlabStream($megabytes, $upload, function (array $sample) use (&$out): bool {
				if (($sample['phase'] ?? '') === 'done') { $out = $sample; }
				return true;
			}, $this->mlab->nearest($servers));
			if ($out !== null) {
				return $out;
			}
		}
		if ($via === self::VIA_MLAB) {
			// The shape a finished measurement has, carrying the reason instead
			// of a number: the caller asked for M-Lab and must not be handed
			// Cloudflare's figure under M-Lab's name.
			return [
				'endpoint' => 'measurement-lab.org',
				'where' => '',
				'megabytes' => $megabytes,
				'latency' => null,
				'download' => null,
				'downloadError' => $this->l->t('No M-Lab measurement server could be reached. Choose Cloudflare instead, or let NetBase choose.'),
				'upload' => null,
				'uploadError' => null,
			];
		}
		return $this->cloudflareTest($megabytes, $upload);
	}

	/**
	 * Which of the two measurements was asked for.
	 *
	 * Anything unrecognised is treated as 'auto' rather than refused: an
	 * older browser that sends nothing, or a newer one that sends a name this
	 * version has not heard of, still gets a measurement.
	 */
	private function provider(string $via): string {
		$via = strtolower(trim($via));
		return in_array($via, [self::VIA_MLAB, self::VIA_CLOUDFLARE], true) ? $via : self::VIA_AUTO;
	}

	/**
	 * One measurement against a named M-Lab server, reported as it runs.
	 *
	 * The readings are sent in the same shape the HTTP test always used, so the
	 * browser draws the same graph without knowing which of the two ran.
	 *
	 * @param array<string, mixed> $server
	 * @param callable(array): bool $emit
	 */
	private function mlabStream(int $megabytes, bool $upload, callable $emit, array $server): void {
		$megabytes = max(1, min(500, $megabytes));
		$cap = $megabytes * 1000000;
		$where = trim(((string)($server['city'] ?? '')) . ' ' . ((string)($server['country'] ?? '')));

		if (!$emit(['phase' => 'start', 'megabytes' => $megabytes, 'upload' => $upload, 'server' => $where])) {
			return;
		}
		// The first reading anybody sees. It is timed against the very machine
		// about to be measured: connecting to somewhere else would report that
		// other network's round trip beside M-Lab's throughput figures, which
		// is what used to happen here. The measurement server reports its own
		// round trip as well, and that lands in the final result where the two
		// accounts can be compared rather than one of them simply believed.
		// Timed against the very host the data will come from. That is not the
		// server's own name: M-Lab lists mlab3-hnd02..., while the bytes arrive
		// from ndt-mlab3-hnd02..., and only the latter answers on 443 at all.
		// Timing the listed name gave no reading; timing a fixed endpoint
		// elsewhere, as this once did, reported another network's round trip
		// beside M-Lab's throughput. Where the data host gives nothing back,
		// that fixed endpoint still supplies a figure rather than a blank.
		$dataHost = (string)parse_url((string)($server['download'] ?? ''), PHP_URL_HOST);
		$latency = $dataHost !== '' ? $this->httpLatency('https://' . $dataHost . '/') : null;
		if ($latency === null) {
			$latency = $this->httpLatency('https://speed.cloudflare.com/__down?bytes=1000');
		}
		if (!$emit(['phase' => 'latency', 'latency' => $latency])) {
			return;
		}

		$live = true;
		$down = $this->mlab->measure('download', $server, 10.0, $cap, function (int $bytes, float $seconds) use ($emit, &$live): bool {
			$live = $emit([
				'phase' => 'down',
				'bytes' => $bytes,
				'seconds' => round($seconds, 3),
				'mbps' => $seconds > 0 ? round($bytes * 8 / $seconds / 1000000, 2) : 0.0,
			]);
			return $live;
		});
		if (!$live) {
			return;
		}
		$downResult = ($down['error'] ?? null) === null
			? ['bytes' => $down['bytes'], 'seconds' => $down['seconds'], 'mbps' => $down['mbps']]
			: null;
		if (!$emit(['phase' => 'downDone', 'download' => $downResult, 'error' => $down['error'] ?? null])) {
			return;
		}

		$upResult = null;
		$upError = null;
		$upRemote = null;
		if ($upload) {
			$up = $this->mlab->measure('upload', $server, 10.0, $cap, function (int $bytes, float $seconds) use ($emit, &$live): bool {
				$live = $emit([
					'phase' => 'up',
					'bytes' => $bytes,
					'seconds' => round($seconds, 3),
					'mbps' => $seconds > 0 ? round($bytes * 8 / $seconds / 1000000, 2) : 0.0,
				]);
				return $live;
			});
			if (!$live) {
				return;
			}
			$upError = $up['error'] ?? null;
			$upResult = $upError === null ? ['bytes' => $up['bytes'], 'seconds' => $up['seconds'], 'mbps' => $up['mbps']] : null;
			$upRemote = $this->mlab->remoteView($up['remote'] ?? null, 'upload');
		}

		$emit([
			'phase' => 'done',
			'endpoint' => (string)($server['machine'] ?? 'measurement-lab.org'),
			'where' => $where,
			'megabytes' => $megabytes,
			'latency' => $latency,
			'download' => $downResult,
			'downloadError' => $down['error'] ?? null,
			'upload' => $upResult,
			'uploadError' => $upError,
			// What the far end saw, so the two accounts can be compared rather
			// than one of them simply believed.
			'remote' => $this->mlab->remoteView($down['remote'] ?? null),
			'remoteUpload' => $upRemote,
		]);
	}

	/** Connect latency and jitter, from a handful of small requests. */
	private function httpLatency(string $url, int $samples = 5): ?array {
		$times = [];
		for ($i = 0; $i < $samples; $i++) {
			$curl = curl_init($url);
			curl_setopt_array($curl, [
				CURLOPT_RETURNTRANSFER => true,
				CURLOPT_TIMEOUT => 10,
				CURLOPT_CONNECTTIMEOUT => 5,
				CURLOPT_FRESH_CONNECT => true,
				CURLOPT_USERAGENT => 'NetBase (Nextcloud)',
			]);
			if (curl_exec($curl) !== false) {
				$times[] = (float)curl_getinfo($curl, CURLINFO_CONNECT_TIME) * 1000;
			}
			curl_close($curl);
		}
		if ($times === []) {
			return null;
		}
		sort($times);
		return [
			'min' => round($times[0], 1),
			'avg' => round(array_sum($times) / count($times), 1),
			'max' => round($times[count($times) - 1], 1),
			'jitter' => count($times) > 1 ? round($this->stdDev($times), 1) : null,
		];
	}

	/**
	 * Where the time goes in one HTTP request: name lookup, connect, TLS
	 * handshake, first byte, transfer.
	 */
	public function httpTiming(string $url): array {
		if (!preg_match('#^https?://#i', $url)) {
			$url = 'https://' . $url;
		}
		if (filter_var($url, FILTER_VALIDATE_URL) === false) {
			throw new \InvalidArgumentException('Not a valid URL');
		}
		// One request, no redirect following: curl reports timings for the last
		// connection it used, and a redirect that reuses the open connection
		// reports a TLS handshake of zero, which would read as "no TLS".
		$curl = curl_init($url);
		curl_setopt_array($curl, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_FOLLOWLOCATION => false,
			CURLOPT_TIMEOUT => 30,
			CURLOPT_CONNECTTIMEOUT => 10,
			CURLOPT_USERAGENT => 'NetBase (Nextcloud)',
		]);
		$body = curl_exec($curl);
		if ($body === false) {
			$error = curl_error($curl);
			curl_close($curl);
			throw new \RuntimeException($error !== '' ? $error : 'Request failed');
		}
		$info = curl_getinfo($curl);
		// The TLS handshake time is not part of the array curl_getinfo()
		// returns; it has to be asked for by name.
		$appconnect = (float)curl_getinfo($curl, CURLINFO_APPCONNECT_TIME);
		curl_close($curl);

		$ms = static fn (string $key) => round((float)($info[$key] ?? 0) * 1000, 1);
		$dns = $ms('namelookup_time');
		$connect = $ms('connect_time');
		$tls = round($appconnect * 1000, 1);
		$first = $ms('starttransfer_time');
		$total = $ms('total_time');

		$headerSize = (int)($info['header_size'] ?? 0);
		$headers = substr((string)$body, 0, $headerSize);
		$location = preg_match('/^Location:\s*(\S+)/mi', $headers, $m) ? $m[1] : null;
		if ($location === null && preg_match('/^Location:\s*(\S+)/mi', (string)$body, $m)) {
			$location = $m[1];
		}

		return [
			'url' => $info['url'] ?? $url,
			'status' => (int)($info['http_code'] ?? 0),
			'location' => $location,
			'ip' => $info['primary_ip'] ?? '',
			'port' => (int)($info['primary_port'] ?? 0),
			'httpVersion' => $info['http_version'] ?? null,
			'bytes' => (int)($info['size_download'] ?? 0),
			'redirects' => (int)($info['redirect_count'] ?? 0),
			'tls' => $tls > 0,
			'phases' => [
				['name' => 'DNS', 'ms' => $dns],
				['name' => 'TCP', 'ms' => round($connect - $dns, 1)],
				['name' => 'TLS', 'ms' => $tls > 0 ? round($tls - $connect, 1) : 0.0],
				['name' => 'Server', 'ms' => round($first - max($tls, $connect), 1)],
				['name' => 'Transfer', 'ms' => round($total - $first, 1)],
			],
			'total' => $total,
		];
	}

	// ---------------------------------------------------------------- iperf3

	public function iperfAvailable(): bool {
		return $this->exec->available('iperf3');
	}

	/**
	 * LAN throughput against an iperf3 server, which has to be running on the
	 * far end (`iperf3 -s`). This is the only honest way to measure a local
	 * link: an internet speed test measures the internet.
	 */
	public function iperf(string $host, int $port = 5201, int $seconds = 10, bool $reverse = false, int $streams = 1): array {
		$host = $this->validateTarget($host);
		if (!$this->iperfAvailable()) {
			return ['available' => false, 'error' => 'iperf3 is not installed on this server'];
		}
		$args = [
			'-c', $host,
			'-p', (string)max(1, min(65535, $port)),
			'-t', (string)max(1, min(60, $seconds)),
			'-P', (string)max(1, min(16, $streams)),
			'--json',
		];
		if ($reverse) {
			$args[] = '-R';
		}
		$result = $this->exec->run('iperf3', $args, (float)($seconds + 25));
		$parsed = json_decode($result['stdout'], true);
		if (!is_array($parsed)) {
			return ['available' => true, 'error' => trim($result['stderr']) ?: 'iperf3 returned no usable output', 'output' => $result['stdout']];
		}
		if (!empty($parsed['error'])) {
			return ['available' => true, 'error' => (string)$parsed['error']];
		}

		$sent = $parsed['end']['sum_sent'] ?? null;
		$received = $parsed['end']['sum_received'] ?? null;
		$intervals = [];
		foreach ($parsed['intervals'] ?? [] as $interval) {
			$sum = $interval['sum'] ?? null;
			if (is_array($sum)) {
				$intervals[] = [
					'start' => round((float)($sum['start'] ?? 0), 1),
					'mbps' => round((float)($sum['bits_per_second'] ?? 0) / 1000000, 2),
				];
			}
		}
		return [
			'available' => true,
			'host' => $host,
			'reverse' => $reverse,
			'streams' => $streams,
			'sentMbps' => $sent ? round((float)$sent['bits_per_second'] / 1000000, 2) : null,
			'receivedMbps' => $received ? round((float)$received['bits_per_second'] / 1000000, 2) : null,
			'retransmits' => $sent['retransmits'] ?? null,
			'seconds' => $sent ? round((float)$sent['seconds'], 1) : null,
			'intervals' => $intervals,
			'version' => $parsed['start']['version'] ?? null,
		];
	}

	// ---------------------------------------------------------------- helpers

	private function validateTarget(string $host): string {
		$host = trim($host);
		if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
			return $host;
		}
		if (!preg_match('/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i', $host)) {
			throw new \InvalidArgumentException($this->l->t('Not a valid host name: %s', [$host]));
		}
		return $host;
	}

	/** @param list<float> $values */
	private function stdDev(array $values): float {
		$count = count($values);
		if ($count < 2) {
			return 0.0;
		}
		$mean = array_sum($values) / $count;
		$sum = 0.0;
		foreach ($values as $value) {
			$sum += ($value - $mean) ** 2;
		}
		return sqrt($sum / ($count - 1));
	}
}
