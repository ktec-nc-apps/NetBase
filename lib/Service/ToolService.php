<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * The lookup tools that sit next to the device list.
 *
 * Everything here works on a stock PHP install: whois speaks port 43 directly,
 * DNS uses the resolver built into PHP, and TLS inspection uses the OpenSSL
 * stream wrapper. External binaries are used only where there is no other way
 * (ping, traceroute), and their absence is reported rather than fatal.
 */
class ToolService {
	private const WHOIS_IANA = 'whois.iana.org';

	/** RIR whois servers, used when IANA does not hand us a referral. */
	private const RIR_SERVERS = [
		'arin' => 'whois.arin.net',
		'ripe' => 'whois.ripe.net',
		'apnic' => 'whois.apnic.net',
		'lacnic' => 'whois.lacnic.net',
		'afrinic' => 'whois.afrinic.net',
	];

	public function __construct(
		private ExecService $exec,
		private DiscoveryService $discovery,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	// ---------------------------------------------------------------- validation

	/** A hostname or IP literal, with anything shell-ish rejected outright. */
	public function validateHost(string $host): string {
		$host = trim($host);
		if ($host === '' || strlen($host) > 253) {
			throw new \InvalidArgumentException('Empty or over-long host');
		}
		if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
			return $host;
		}
		$idn = $host;
		if (function_exists('idn_to_ascii') && preg_match('/[^\x20-\x7e]/', $host)) {
			$converted = idn_to_ascii($host, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
			if (is_string($converted) && $converted !== '') {
				$idn = $converted;
			}
		}
		if (!preg_match('/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i', $idn)) {
			throw new \InvalidArgumentException('Not a valid host name: ' . $host);
		}
		return $idn;
	}

	// ---------------------------------------------------------------- whois

	/**
	 * @return array{query: string, kind: string, chain: list<array{server: string, response: string}>, fields: array<string,string>}
	 */
	public function whois(string $query, int $maxReferrals = 2): array {
		$query = trim($query);
		$isIp = filter_var($query, FILTER_VALIDATE_IP) !== false;
		if (!$isIp) {
			$query = $this->validateHost($query);
		}

		$server = self::WHOIS_IANA;
		$chain = [];
		$seen = [];
		for ($hop = 0; $hop <= $maxReferrals; $hop++) {
			if (isset($seen[$server])) {
				break;
			}
			$seen[$server] = true;
			$response = $this->whoisAsk($server, $query, $isIp);
			$chain[] = ['server' => $server, 'response' => $response];
			$next = $this->whoisReferral($response);
			if ($next === null || $next === $server) {
				break;
			}
			$server = $next;
		}

		$body = end($chain)['response'] ?? '';
		return [
			'query' => $query,
			'kind' => $isIp ? 'ip' : 'domain',
			'chain' => $chain,
			'fields' => $isIp ? $this->parseIpWhois($body) : $this->parseDomainWhois($body),
		];
	}

	private function whoisAsk(string $server, string $query, bool $isIp): string {
		$server = $this->validateHost($server);
		$errno = 0;
		$errstr = '';
		$fp = @stream_socket_client('tcp://' . $server . ':43', $errno, $errstr, 6.0);
		if ($fp === false) {
			return '[could not reach ' . $server . ': ' . $errstr . ']';
		}
		stream_set_timeout($fp, 8);
		// RIPE-style servers need -B for full contact output; ARIN needs n + for networks.
		$line = $query;
		if ($isIp && str_contains($server, 'arin')) {
			$line = 'n + ' . $query;
		}
		fwrite($fp, $line . "\r\n");
		$out = '';
		while (!feof($fp) && strlen($out) < 262144) {
			$chunk = fread($fp, 8192);
			if ($chunk === false || $chunk === '') {
				break;
			}
			$out .= $chunk;
		}
		fclose($fp);
		return trim($out);
	}

	private function whoisReferral(string $response): ?string {
		foreach (['/^[ \t]*refer:[ \t]*(\S+)/mi', '/^[ \t]*Registrar WHOIS Server:[ \t]*(\S+)/mi', '/^[ \t]*whois:[ \t]*(\S+)/mi', '/^[ \t]*ReferralServer:[ \t]*(?:r?whois:\/\/)?([^:\s]+)/mi'] as $pattern) {
			if (preg_match($pattern, $response, $m)) {
				$candidate = strtolower(trim($m[1]));
				if ($candidate !== '' && filter_var('http://' . $candidate, FILTER_VALIDATE_URL) !== false) {
					return $candidate;
				}
			}
		}
		return null;
	}

	private function parseDomainWhois(string $body): array {
		$map = [
			'registrar' => '/^[ \t]*Registrar:[ \t]*(.+)$/mi',
			'created' => '/^[ \t]*(?:Creation Date|Created On|Registered on|Domain Registration Date|\[登録年月日\]):[ \t]*(.+)$/mi',
			'updated' => '/^[ \t]*(?:Updated Date|Last Modified|\[最終更新\]):[ \t]*(.+)$/mi',
			'expires' => '/^[ \t]*(?:Registry Expiry Date|Expiration Date|Expires on|\[有効期限\]):[ \t]*(.+)$/mi',
			'status' => '/^[ \t]*(?:Domain Status|\[状態\]):[ \t]*(.+)$/mi',
			'registrant' => '/^[ \t]*(?:Registrant Organization|Registrant Name|\[組織名\]|\[Registrant\]):[ \t]*(.+)$/mi',
			'abuse' => '/^[ \t]*Registrar Abuse Contact Email:[ \t]*(.+)$/mi',
		];
		$fields = [];
		foreach ($map as $key => $pattern) {
			if (preg_match($pattern, $body, $m) && trim($m[1]) !== '') {
				$fields[$key] = trim($m[1]);
			}
		}
		if (preg_match_all('/^[ \t]*(?:Name Server|\[Name Server\]):[ \t]*(\S+)$/mi', $body, $m)) {
			$fields['nameservers'] = implode(', ', array_unique(array_map('strtolower', $m[1])));
		}
		return $fields;
	}

	private function parseIpWhois(string $body): array {
		$map = [
			'range' => '/^[ \t]*(?:inetnum|NetRange|a\.\s*\[.*\]):[ \t]*(.+)$/mi',
			'cidr' => '/^[ \t]*CIDR:[ \t]*(.+)$/mi',
			'name' => '/^[ \t]*(?:netname|NetName):[ \t]*(.+)$/mi',
			'org' => '/^[ \t]*(?:org-name|Organization|OrgName|descr):[ \t]*(.+)$/mi',
			'country' => '/^[ \t]*(?:country|Country):[ \t]*(.+)$/mi',
			'abuse' => '/^[ \t]*(?:abuse-mailbox|OrgAbuseEmail):[ \t]*(.+)$/mi',
			'asn' => '/^[ \t]*(?:origin|OriginAS):[ \t]*(.+)$/mi',
		];
		$fields = [];
		foreach ($map as $key => $pattern) {
			if (preg_match($pattern, $body, $m) && trim($m[1]) !== '') {
				$fields[$key] = trim($m[1]);
			}
		}
		return $fields;
	}

	// ---------------------------------------------------------------- dns

	public function dns(string $host, array $types = []): array {
		$host = $this->validateHost($host);
		$all = ['A' => DNS_A, 'AAAA' => DNS_AAAA, 'CNAME' => DNS_CNAME, 'MX' => DNS_MX, 'NS' => DNS_NS, 'TXT' => DNS_TXT, 'SOA' => DNS_SOA, 'SRV' => DNS_SRV, 'CAA' => 257, 'PTR' => DNS_PTR];
		$wanted = $types === [] ? ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA'] : array_values(array_intersect(array_map('strtoupper', $types), array_keys($all)));

		$records = [];
		foreach ($wanted as $type) {
			$found = @dns_get_record($host, $all[$type]);
			if (!is_array($found)) {
				continue;
			}
			foreach ($found as $record) {
				$records[] = [
					'type' => $record['type'] ?? $type,
					'ttl' => $record['ttl'] ?? null,
					'value' => $this->dnsValue($record),
				];
			}
		}

		$analysis = [];
		foreach ($records as $record) {
			if (($record['type'] ?? '') !== 'TXT') {
				continue;
			}
			if (stripos($record['value'], 'v=spf1') === 0) {
				$analysis['spf'] = $record['value'];
			}
		}
		$dmarc = @dns_get_record('_dmarc.' . $host, DNS_TXT);
		if (is_array($dmarc) && $dmarc !== []) {
			$analysis['dmarc'] = $this->dnsValue($dmarc[0]);
		}

		return ['host' => $host, 'records' => $records, 'analysis' => $analysis];
	}

	private function dnsValue(array $record): string {
		return match ($record['type'] ?? '') {
			'A' => (string)($record['ip'] ?? ''),
			'AAAA' => (string)($record['ipv6'] ?? ''),
			'CNAME', 'NS', 'PTR' => (string)($record['target'] ?? ''),
			'MX' => sprintf('%d %s', (int)($record['pri'] ?? 0), $record['target'] ?? ''),
			'TXT' => (string)($record['txt'] ?? implode('', $record['entries'] ?? [])),
			'SOA' => sprintf('%s %s serial=%s refresh=%s retry=%s expire=%s min=%s', $record['mname'] ?? '', $record['rname'] ?? '', $record['serial'] ?? '', $record['refresh'] ?? '', $record['retry'] ?? '', $record['expire'] ?? '', $record['minimum-ttl'] ?? ''),
			'SRV' => sprintf('%d %d %d %s', (int)($record['pri'] ?? 0), (int)($record['weight'] ?? 0), (int)($record['port'] ?? 0), $record['target'] ?? ''),
			default => trim(implode(' ', array_map(static fn ($v) => is_scalar($v) ? (string)$v : '', $record))),
		};
	}

	public function reverseLookup(string $ip): array {
		if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
			throw new \InvalidArgumentException('Not an IP address');
		}
		$name = @gethostbyaddr($ip);
		return ['ip' => $ip, 'name' => ($name !== false && $name !== $ip) ? $name : null];
	}

	// ---------------------------------------------------------------- reachability

	public function ping(string $host, int $count = 4, bool $ipv6 = false): array {
		$host = $this->validateHost($host);
		$count = max(1, min(20, $count));
		$binary = $ipv6 && $this->exec->available('ping6') ? 'ping6' : 'ping';
		$args = ['-c', (string)$count, '-W', '2', '-n'];
		if ($ipv6 && $binary === 'ping') {
			$args[] = '-6';
		}
		$args[] = $host;
		$result = $this->exec->run($binary, $args, (float)($count * 2 + 5));

		$stats = [];
		if (preg_match('/(\d+) packets transmitted, (\d+) (?:packets )?received.*?([\d.]+)% packet loss/s', $result['stdout'], $m)) {
			$stats = ['sent' => (int)$m[1], 'received' => (int)$m[2], 'loss' => (float)$m[3]];
		}
		if (preg_match('#min/avg/max/[a-z]+ = ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)#', $result['stdout'], $m)) {
			$stats += ['min' => (float)$m[1], 'avg' => (float)$m[2], 'max' => (float)$m[3], 'mdev' => (float)$m[4]];
		}
		return ['host' => $host, 'stats' => $stats, 'output' => $result['stdout'] ?: $result['stderr'], 'available' => $result['code'] !== 127];
	}

	public function traceroute(string $host, int $maxHops = 20): array {
		$host = $this->validateHost($host);
		$maxHops = max(1, min(40, $maxHops));
		foreach ([['traceroute', ['-n', '-q', '1', '-w', '2', '-m', (string)$maxHops, $host]], ['tracepath', ['-n', '-m', (string)$maxHops, $host]]] as [$binary, $args]) {
			if (!$this->exec->available($binary)) {
				continue;
			}
			$result = $this->exec->run($binary, $args, 60.0);
			return ['host' => $host, 'tool' => $binary, 'output' => $result['stdout'] ?: $result['stderr'], 'available' => true];
		}
		return ['host' => $host, 'tool' => null, 'output' => '', 'available' => false];
	}

	/**
	 * Per-hop packet loss and latency along a route.
	 *
	 * Traceroute shows where the packets go; this shows where they suffer,
	 * which is usually the question actually being asked.
	 */
	public function pathQuality(string $host, int $count = 10): array {
		$host = $this->validateHost($host);
		$count = max(3, min(60, $count));
		if (!$this->exec->available('mtr')) {
			return ['available' => false, 'host' => $host, 'hops' => []];
		}
		$result = $this->exec->run('mtr', ['--json', '-n', '-c', (string)$count, $host], (float)($count * 2 + 20));
		$parsed = json_decode($result['stdout'], true);
		if (!is_array($parsed) || !isset($parsed['report']['hubs'])) {
			return [
				'available' => true,
				'host' => $host,
				'hops' => [],
				'error' => trim($result['stderr']) ?: 'mtr returned no usable output',
			];
		}
		$hops = [];
		foreach ($parsed['report']['hubs'] as $hub) {
			$hops[] = [
				'hop' => (int)($hub['count'] ?? 0),
				'host' => (string)($hub['host'] ?? '???'),
				'loss' => round((float)($hub['Loss%'] ?? 0), 1),
				'sent' => (int)($hub['Snt'] ?? 0),
				'last' => round((float)($hub['Last'] ?? 0), 1),
				'avg' => round((float)($hub['Avg'] ?? 0), 1),
				'best' => round((float)($hub['Best'] ?? 0), 1),
				'worst' => round((float)($hub['Wrst'] ?? 0), 1),
				'jitter' => round((float)($hub['StDev'] ?? 0), 1),
			];
		}
		return ['available' => true, 'host' => $host, 'count' => $count, 'hops' => $hops];
	}

	/**
	 * TCP connect check with a short banner read, for one host and a port list.
	 */
	public function portCheck(string $host, array $ports, float $timeout = 1.5): array {
		$host = $this->validateHost($host);
		$ports = array_values(array_filter(array_map('intval', $ports), static fn ($p) => $p > 0 && $p < 65536));
		if ($ports === []) {
			throw new \InvalidArgumentException('No ports given');
		}
		$results = [];
		foreach (array_slice($ports, 0, 128) as $port) {
			$started = microtime(true);
			$target = str_contains($host, ':') ? '[' . $host . ']' : $host;
			$errno = 0;
			$errstr = '';
			$sock = @stream_socket_client('tcp://' . $target . ':' . $port, $errno, $errstr, $timeout);
			$elapsed = round((microtime(true) - $started) * 1000, 1);
			if ($sock === false) {
				$results[] = ['port' => $port, 'open' => false, 'ms' => $elapsed, 'service' => $this->serviceName($port), 'banner' => null, 'error' => $errstr];
				continue;
			}
			stream_set_timeout($sock, 1);
			stream_set_blocking($sock, false);
			usleep(250000);
			$banner = (string)@fread($sock, 512);
			if ($banner === '' && in_array($port, [80, 8080, 8000], true)) {
				@fwrite($sock, "HEAD / HTTP/1.0\r\nHost: " . $host . "\r\n\r\n");
				usleep(300000);
				$banner = (string)@fread($sock, 512);
			}
			@fclose($sock);
			$results[] = [
				'port' => $port,
				'open' => true,
				'ms' => $elapsed,
				'service' => $this->serviceName($port),
				'banner' => $banner !== '' ? mb_substr(preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', '', $banner) ?? '', 0, 300) : null,
				'error' => null,
			];
		}
		return ['host' => $host, 'results' => $results];
	}

	public function serviceName(int $port): string {
		$known = [
			21 => 'ftp', 22 => 'ssh', 23 => 'telnet', 25 => 'smtp', 53 => 'dns', 80 => 'http',
			110 => 'pop3', 123 => 'ntp', 135 => 'msrpc', 139 => 'netbios-ssn', 143 => 'imap',
			161 => 'snmp', 389 => 'ldap', 443 => 'https', 445 => 'microsoft-ds', 465 => 'smtps',
			515 => 'printer', 554 => 'rtsp', 587 => 'submission', 631 => 'ipp', 993 => 'imaps',
			995 => 'pop3s', 1883 => 'mqtt', 1900 => 'ssdp', 3000 => 'http-alt', 3306 => 'mysql',
			3389 => 'ms-wbt', 5000 => 'upnp/nas', 5001 => 'nas-https', 5060 => 'sip', 5432 => 'postgresql',
			5353 => 'mdns', 5900 => 'vnc', 6379 => 'redis', 8006 => 'proxmox', 8080 => 'http-proxy',
			8443 => 'https-alt', 9000 => 'http-alt', 9100 => 'jetdirect', 27017 => 'mongodb',
		];
		return $known[$port] ?? '';
	}

	// ---------------------------------------------------------------- tls / http

	public function tls(string $host, int $port = 443): array {
		$host = $this->validateHost($host);
		$port = max(1, min(65535, $port));
		$context = stream_context_create(['ssl' => [
			'capture_peer_cert' => true,
			'capture_peer_cert_chain' => true,
			'verify_peer' => false,
			'verify_peer_name' => false,
			'SNI_enabled' => true,
			'peer_name' => $host,
		]]);
		$errno = 0;
		$errstr = '';
		$target = str_contains($host, ':') ? '[' . $host . ']' : $host;
		$client = @stream_socket_client('ssl://' . $target . ':' . $port, $errno, $errstr, 8.0, STREAM_CLIENT_CONNECT, $context);
		if ($client === false) {
			return ['host' => $host, 'port' => $port, 'ok' => false, 'error' => $errstr ?: 'TLS handshake failed'];
		}
		$params = stream_context_get_params($client);
		$meta = stream_get_meta_data($client);
		@fclose($client);

		$cert = $params['options']['ssl']['peer_certificate'] ?? null;
		if ($cert === null) {
			return ['host' => $host, 'port' => $port, 'ok' => false, 'error' => 'No certificate presented'];
		}
		$parsed = openssl_x509_parse($cert) ?: [];
		$sans = [];
		if (!empty($parsed['extensions']['subjectAltName'])) {
			foreach (explode(',', $parsed['extensions']['subjectAltName']) as $entry) {
				$entry = trim($entry);
				if (str_starts_with($entry, 'DNS:')) {
					$sans[] = substr($entry, 4);
				}
			}
		}
		$chain = [];
		foreach ($params['options']['ssl']['peer_certificate_chain'] ?? [] as $link) {
			$info = openssl_x509_parse($link) ?: [];
			$chain[] = [
				'subject' => $info['subject']['CN'] ?? ($info['name'] ?? ''),
				'issuer' => $info['issuer']['CN'] ?? '',
				'validTo' => isset($info['validTo_time_t']) ? (int)$info['validTo_time_t'] : null,
			];
		}
		$validTo = isset($parsed['validTo_time_t']) ? (int)$parsed['validTo_time_t'] : null;

		return [
			'host' => $host,
			'port' => $port,
			'ok' => true,
			'subject' => $parsed['subject']['CN'] ?? '',
			'issuer' => $parsed['issuer']['CN'] ?? ($parsed['issuer']['O'] ?? ''),
			'serial' => $parsed['serialNumberHex'] ?? ($parsed['serialNumber'] ?? ''),
			'signatureType' => $parsed['signatureTypeSN'] ?? '',
			'validFrom' => isset($parsed['validFrom_time_t']) ? (int)$parsed['validFrom_time_t'] : null,
			'validTo' => $validTo,
			'daysLeft' => $validTo !== null ? (int)floor(($validTo - time()) / 86400) : null,
			'expired' => $validTo !== null && $validTo < time(),
			'sans' => $sans,
			'chain' => $chain,
			'protocol' => $meta['crypto']['protocol'] ?? '',
			'cipher' => $meta['crypto']['cipher_name'] ?? '',
		];
	}

	/** Follow an HTTP(S) URL and report every hop plus the final headers. */
	public function http(string $url, int $maxRedirects = 5): array {
		if (!preg_match('#^https?://#i', $url)) {
			$url = 'https://' . $url;
		}
		if (filter_var($url, FILTER_VALIDATE_URL) === false) {
			throw new \InvalidArgumentException('Not a valid URL');
		}
		$this->validateHost((string)parse_url($url, PHP_URL_HOST));

		$chain = [];
		$current = $url;
		$headers = [];
		for ($hop = 0; $hop <= $maxRedirects; $hop++) {
			$context = stream_context_create([
				'http' => ['method' => 'GET', 'follow_location' => 0, 'timeout' => 10, 'ignore_errors' => true, 'header' => "User-Agent: NetBase (Nextcloud)\r\nAccept: */*\r\n"],
				'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
			]);
			$started = microtime(true);
			$body = @file_get_contents($current, false, $context, 0, 4096);
			$raw = $http_response_header ?? [];
			$ms = round((microtime(true) - $started) * 1000, 1);
			$status = 0;
			$headers = [];
			foreach ($raw as $line) {
				if (preg_match('#^HTTP/[\d.]+\s+(\d{3})#', $line, $m)) {
					$status = (int)$m[1];
					$headers = [];
					continue;
				}
				$parts = explode(':', $line, 2);
				if (count($parts) === 2) {
					$headers[strtolower(trim($parts[0]))] = trim($parts[1]);
				}
			}
			$chain[] = ['url' => $current, 'status' => $status, 'ms' => $ms, 'server' => $headers['server'] ?? ''];
			if ($status >= 300 && $status < 400 && !empty($headers['location'])) {
				$next = $headers['location'];
				if (!preg_match('#^https?://#i', $next)) {
					$base = parse_url($current);
					$next = ($base['scheme'] ?? 'https') . '://' . ($base['host'] ?? '') . (str_starts_with($next, '/') ? '' : '/') . $next;
				}
				$current = $next;
				continue;
			}
			break;
		}

		$security = [];
		foreach (['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'] as $header) {
			$security[$header] = $headers[$header] ?? null;
		}
		return ['url' => $url, 'chain' => $chain, 'headers' => $headers, 'security' => $security];
	}

	// ---------------------------------------------------------------- utilities

	/** Subnet maths for IPv4 and IPv6. */
	public function subnet(string $input): array {
		$input = trim($input);
		if (!str_contains($input, '/')) {
			$input .= filter_var($input, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) ? '/64' : '/24';
		}
		[$address, $bits] = explode('/', $input, 2);
		$bits = (int)$bits;

		if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
			if ($bits < 0 || $bits > 32) {
				throw new \InvalidArgumentException('Prefix length must be 0-32');
			}
			$long = ip2long($address);
			$mask = $bits === 0 ? 0 : (-1 << (32 - $bits)) & 0xFFFFFFFF;
			$network = $long & $mask;
			$broadcast = $network | (~$mask & 0xFFFFFFFF);
			$size = 2 ** (32 - $bits);
			return [
				'family' => 'IPv4',
				'address' => $address,
				'cidr' => $bits,
				'netmask' => long2ip($mask),
				'wildcard' => long2ip(~$mask & 0xFFFFFFFF),
				'network' => long2ip($network),
				'broadcast' => long2ip($broadcast),
				'firstHost' => $size > 2 ? long2ip($network + 1) : long2ip($network),
				'lastHost' => $size > 2 ? long2ip($broadcast - 1) : long2ip($broadcast),
				'hosts' => $size > 2 ? $size - 2 : $size,
				'total' => $size,
				'private' => filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE) === false,
				'range' => long2ip($network) . ' – ' . long2ip($broadcast),
			];
		}

		if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
			if ($bits < 0 || $bits > 128) {
				throw new \InvalidArgumentException('Prefix length must be 0-128');
			}
			$packed = inet_pton($address);
			$maskBytes = '';
			for ($i = 0; $i < 16; $i++) {
				$remaining = $bits - $i * 8;
				$maskBytes .= chr($remaining >= 8 ? 0xFF : ($remaining <= 0 ? 0x00 : (0xFF << (8 - $remaining)) & 0xFF));
			}
			$network = $packed & $maskBytes;
			$last = $network | ~$maskBytes;
			return [
				'family' => 'IPv6',
				'address' => inet_ntop($packed),
				'cidr' => $bits,
				'network' => inet_ntop($network),
				'lastHost' => inet_ntop($last),
				'total' => $bits >= 64 ? number_format(2 ** (128 - $bits)) : '2^' . (128 - $bits),
				'range' => inet_ntop($network) . ' – ' . inet_ntop($last),
				'private' => str_starts_with(strtolower($address), 'fd') || str_starts_with(strtolower($address), 'fc') || str_starts_with(strtolower($address), 'fe80'),
			];
		}

		throw new \InvalidArgumentException('Not an IP address');
	}

	/** Wake-on-LAN magic packet. */
	public function wakeOnLan(string $mac, string $broadcast = '255.255.255.255', int $port = 9): array {
		$hex = strtoupper(preg_replace('/[^0-9A-Fa-f]/', '', $mac) ?? '');
		if (strlen($hex) !== 12) {
			throw new \InvalidArgumentException('Not a MAC address');
		}
		if (filter_var($broadcast, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
			throw new \InvalidArgumentException('Not a broadcast address');
		}
		$packet = str_repeat("\xFF", 6) . str_repeat(hex2bin($hex), 16);
		if (!$this->discovery->hasSockets()) {
			// A magic packet goes to a broadcast address, and SO_BROADCAST can
			// only be set through ext-sockets.
			return ['sent' => false, 'error' => 'Wake-on-LAN needs the PHP sockets extension, which is not installed'];
		}
		$sock = @socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
		if ($sock === false) {
			return ['sent' => false, 'error' => 'Could not open a UDP socket'];
		}
		@socket_set_option($sock, SOL_SOCKET, SO_BROADCAST, 1);
		$sent = @socket_sendto($sock, $packet, strlen($packet), 0, $broadcast, max(1, min(65535, $port)));
		socket_close($sock);
		return ['sent' => $sent !== false, 'mac' => strtolower(implode(':', str_split(strtolower($hex), 2))), 'broadcast' => $broadcast, 'port' => $port];
	}

	/** This server's own network picture. */
	public function serverInfo(): array {
		$listeners = [];
		if ($this->exec->available('ss')) {
			$result = $this->exec->run('ss', ['-tulnp'], 8.0);
			$listeners = array_slice(array_filter(explode("\n", $result['stdout'])), 0, 200);
		} elseif ($this->exec->available('netstat')) {
			$result = $this->exec->run('netstat', ['-tuln'], 8.0);
			$listeners = array_slice(array_filter(explode("\n", $result['stdout'])), 0, 200);
		}

		$resolvers = [];
		foreach (@file('/etc/resolv.conf') ?: [] as $line) {
			if (preg_match('/^\s*nameserver\s+(\S+)/', $line, $m)) {
				$resolvers[] = $m[1];
			}
		}

		return [
			'hostname' => gethostname(),
			'interfaces' => $this->discovery->interfaces(),
			'defaultRoute' => $this->discovery->defaultRoute(),
			'resolvers' => $resolvers,
			'listeners' => $listeners,
			'neighbours' => count($this->discovery->neighbours()),
		];
	}
}
