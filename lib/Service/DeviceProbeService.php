<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\DeviceMapper;
use Psr\Log\LoggerInterface;

/**
 * What one device, on its own, will admit to.
 *
 * A sweep has to be quick because it is walking a whole network. One device
 * is a different question: it can be asked about every port it has, and each
 * open one can be asked whether it is a web page — which is the only honest
 * way to know, short of guessing from the number.
 */
class DeviceProbeService {
	/** Ports checked per request. Enough to be worth a round trip, few enough to return inside one. */
	public const SLICE = 2048;

	/**
	 * How many connections one device is asked to hold at once.
	 *
	 * A sweep opens 512, because it is spreading them over a whole network. A
	 * single device is not a network, and an older one cannot cope: a Brother
	 * printer here answers on 80, and at 512 and at 128 it was missed every
	 * time, at any timeout, simply because it dropped the flood. At 64 it is
	 * found. Being slower and right beats being quick and wrong, and this is a
	 * search somebody asked for on purpose.
	 */
	private const AT_ONCE = 64;

	public const LAST_PORT = 65535;

	public function __construct(
		private DiscoveryService $discovery,
		private DeviceMapper $devices,
		private ToolService $tools,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * One slice of a whole-device port scan.
	 *
	 * The browser asks for the next slice until `done`, so a scan of every
	 * port never sits in a single request long enough to be cut off.
	 *
	 * @return array{open: list<int>, from: int, to: int, done: bool, next: int}
	 */
	public function ports(string $ip, int $from = 1, float $wait = 0.3): array {
		$this->tools->validateHost($ip);
		$from = max(1, min(self::LAST_PORT, $from));
		$to = min(self::LAST_PORT, $from + self::SLICE - 1);
		$wait = min(2.0, max(0.1, $wait));

		$found = $this->discovery->tcpSweep([$ip], range($from, $to), $wait, self::AT_ONCE);
		$open = array_map('intval', $found[$ip] ?? []);
		sort($open);

		return [
			'open' => array_values($open),
			'from' => $from,
			'to' => $to,
			'done' => $to >= self::LAST_PORT,
			'next' => $to + 1,
		];
	}

	/**
	 * A second, slower look at the ports worth being sure about.
	 *
	 * The whole range has to be walked briskly or it takes half an hour, and a
	 * brisk walk misses the slowest answers: the same printer that needs 64
	 * connections rather than 512 also needs two seconds to admit to 631. So
	 * once the range is done, the ports that actually mean something are asked
	 * again, patiently. It is a hundred-odd ports and costs a few seconds.
	 *
	 * @return list<int>
	 */
	public function careful(string $ip, float $wait = 2.0): array {
		$this->tools->validateHost($ip);
		$found = $this->discovery->tcpSweep([$ip], DiscoveryService::DETAILED_PORTS, $wait, self::AT_ONCE);
		$open = array_map('intval', $found[$ip] ?? []);
		sort($open);
		return array_values($open);
	}

	/**
	 * Which of these ports actually serve a web page.
	 *
	 * Each is asked for its front page over http and, failing that, https. A
	 * port that answers with a status line is a web page whatever its number;
	 * one that answers with anything else is not, whatever its number. The
	 * title is taken when the page gives one, because "RT-AC68U" tells an
	 * engineer more than "8443" does.
	 *
	 * @param list<int> $ports
	 * @return list<array{port: int, scheme: string, status: int, title: string, server: string}>
	 */
	public function web(string $ip, array $ports, float $timeout = 2.5): array {
		$this->tools->validateHost($ip);
		$ports = array_values(array_unique(array_filter(
			array_map('intval', $ports),
			static fn (int $p) => $p > 0 && $p <= self::LAST_PORT,
		)));
		if ($ports === []) {
			return [];
		}
		$out = [];
		foreach (array_slice($ports, 0, 200) as $port) {
			foreach ($this->schemesFor($port) as $scheme) {
				$page = $this->fetchHead($scheme, $ip, $port, $timeout);
				if ($page === null) {
					continue;
				}
				$out[] = ['port' => $port] + $page;
				break;                       // one answer per port is enough
			}
		}
		return $out;
	}

	/** https first where the number says so, otherwise plain http first. */
	private function schemesFor(int $port): array {
		$secure = in_array($port, [443, 4443, 5001, 8006, 8443, 9443, 10000, 2083, 2087], true);
		return $secure ? ['https', 'http'] : ['http', 'https'];
	}

	/**
	 * @return array{scheme: string, status: int, title: string, server: string}|null
	 */
	private function fetchHead(string $scheme, string $ip, int $port, float $timeout): ?array {
		$host = str_contains($ip, ':') ? '[' . $ip . ']' : $ip;
		$curl = curl_init($scheme . '://' . $host . ':' . $port . '/');
		if ($curl === false) {
			return null;
		}
		$headers = [];
		curl_setopt_array($curl, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_CONNECTTIMEOUT => (int)ceil($timeout),
			CURLOPT_TIMEOUT => (int)ceil($timeout) + 1,
			CURLOPT_FOLLOWLOCATION => false,
			// A device's certificate is its own, and never one a CA has heard of.
			CURLOPT_SSL_VERIFYPEER => false,
			CURLOPT_SSL_VERIFYHOST => 0,
			CURLOPT_NOSIGNAL => true,
			// Enough of the page to find a title, and no more.
			CURLOPT_RANGE => '0-16384',
			CURLOPT_USERAGENT => 'NetBase',
			CURLOPT_HEADERFUNCTION => function ($handle, string $line) use (&$headers) {
				$parts = explode(':', $line, 2);
				if (count($parts) === 2) {
					$headers[strtolower(trim($parts[0]))] = trim($parts[1]);
				}
				return strlen($line);
			},
		]);
		$body = curl_exec($curl);
		$status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
		curl_close($curl);

		// No status line means nothing spoke HTTP here — an SSH banner, a
		// printer's raw port, or silence.
		if ($status === 0) {
			return null;
		}
		return [
			'scheme' => $scheme,
			'status' => $status,
			'title' => $this->titleOf(is_string($body) ? $body : ''),
			'server' => mb_substr((string)($headers['server'] ?? ''), 0, 80),
		];
	}

	private function titleOf(string $body): string {
		if (preg_match('#<title[^>]*>(.*?)</title>#is', $body, $m) !== 1) {
			return '';
		}
		$title = html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
		$title = trim(preg_replace('/\s+/u', ' ', $title) ?? '');
		return mb_substr($title, 0, 120);
	}

	/**
	 * Keep what was found against the device, so the list and the drawer show
	 * it after the panel is closed.
	 *
	 * @param list<int> $ports
	 * @param list<int> $web
	 */
	public function remember(string $ip, ?array $ports, ?array $web): void {
		$device = $this->devices->findByIp($ip);
		if ($device === null) {
			return;
		}
		if ($ports !== null) {
			sort($ports);
			$device->setPorts(mb_substr(implode(',', $ports), 0, 512));
		}
		if ($web !== null) {
			$extra = json_decode((string)$device->getExtra(), true);
			$extra = is_array($extra) ? $extra : [];
			sort($web);
			$extra['web'] = array_values($web);
			$device->setExtra((string)json_encode($extra));
		}
		$this->devices->update($device);
	}
}
