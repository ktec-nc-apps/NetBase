<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use Psr\Log\LoggerInterface;

/**
 * DNS beyond what PHP's own resolver functions can do.
 *
 * dns_get_record() can only ask for the handful of types it knows, always uses
 * the system resolver, and hides the flags. This speaks DNS itself — one UDP
 * packet, or TCP when the answer is truncated or a zone transfer is being
 * tested — so any record type can be asked of any server, and the answer comes
 * back with its flags intact.
 */
class DnsService {
	/** Types worth offering, by name. */
	public const TYPES = [
		'A' => 1, 'NS' => 2, 'CNAME' => 5, 'SOA' => 6, 'PTR' => 12, 'MX' => 15, 'TXT' => 16,
		'AAAA' => 28, 'SRV' => 33, 'NAPTR' => 35, 'DS' => 43, 'SSHFP' => 44, 'DNSKEY' => 48,
		'TLSA' => 52, 'SVCB' => 64, 'HTTPS' => 65, 'SPF' => 99, 'CAA' => 257, 'ANY' => 255,
	];

	/** Public resolvers used for the side-by-side comparison. */
	public const PUBLIC_RESOLVERS = [
		'1.1.1.1' => 'Cloudflare',
		'8.8.8.8' => 'Google',
		'9.9.9.9' => 'Quad9',
		'208.67.222.222' => 'OpenDNS',
		'1.0.0.1' => 'Cloudflare (secondary)',
		'8.8.4.4' => 'Google (secondary)',
	];

	/** The 13 root servers, by their addresses — the start of any delegation trace. */
	private const ROOTS = [
		'198.41.0.4' => 'a.root-servers.net',
		'199.9.14.201' => 'b.root-servers.net',
		'192.33.4.12' => 'c.root-servers.net',
		'199.7.91.13' => 'd.root-servers.net',
	];

	private const RCODES = [
		0 => 'NOERROR', 1 => 'FORMERR', 2 => 'SERVFAIL', 3 => 'NXDOMAIN',
		4 => 'NOTIMP', 5 => 'REFUSED', 9 => 'NOTAUTH', 10 => 'NOTZONE',
	];

	public function __construct(
		private ToolService $tools,
		private L10nService $l,
		private LoggerInterface $logger,
	) {
	}

	// ------------------------------------------------------------------ queries

	/**
	 * One question, asked of one server.
	 *
	 * @return array<string, mixed>
	 */
	public function query(string $name, string $type = 'A', ?string $server = null, bool $dnssec = false, float $timeout = 4.0): array {
		$name = $this->tools->validateDnsName($name);
		$type = strtoupper($type);
		if (!isset(self::TYPES[$type])) {
			throw new \InvalidArgumentException('Unknown record type: ' . $type);
		}
		$server = $server !== null && $server !== '' ? $this->resolverAddress($server) : $this->systemResolver();
		$started = microtime(true);
		$response = $this->ask($server, $name, self::TYPES[$type], $dnssec, $timeout);
		$response['ms'] = round((microtime(true) - $started) * 1000, 1);
		$response['server'] = $server;
		$response['name'] = $name;
		$response['type'] = $type;
		return $response;
	}

	/**
	 * The same question asked of several public resolvers at once — the honest
	 * way to answer "has my change propagated yet?".
	 *
	 * @param list<string> $resolvers
	 * @return array<string, mixed>
	 */
	public function compare(string $name, string $type = 'A', array $resolvers = []): array {
		$name = $this->tools->validateDnsName($name);
		$type = strtoupper($type);
		if (!isset(self::TYPES[$type])) {
			throw new \InvalidArgumentException('Unknown record type: ' . $type);
		}
		$targets = [];
		$system = $this->systemResolver();
		if ($system !== null) {
			$targets[$system] = $this->l->t('This server');
		}
		foreach ($resolvers !== [] ? $resolvers : array_keys(self::PUBLIC_RESOLVERS) as $resolver) {
			$address = $this->resolverAddress($resolver);
			if ($address !== null) {
				$targets[$address] = self::PUBLIC_RESOLVERS[$address] ?? $resolver;
			}
		}

		$rows = [];
		$signatures = [];
		foreach ($targets as $address => $label) {
			$started = microtime(true);
			$answer = $this->ask($address, $name, self::TYPES[$type], false, 3.0);
			$values = array_map(static fn (array $r) => $r['value'], $answer['answers']);
			sort($values);
			$signature = implode(' | ', $values);
			$signatures[$signature] = ($signatures[$signature] ?? 0) + 1;
			$rows[] = [
				'server' => $address,
				'label' => $label,
				'ms' => round((microtime(true) - $started) * 1000, 1),
				'status' => $answer['status'],
				'values' => $values,
				'signature' => $signature,
				'ttl' => $answer['answers'][0]['ttl'] ?? null,
			];
		}
		arsort($signatures);
		$majority = array_key_first($signatures);
		foreach ($rows as &$row) {
			$row['agrees'] = $row['signature'] === $majority;
		}
		unset($row);

		return [
			'name' => $name, 'type' => $type, 'rows' => $rows,
			'consistent' => count($signatures) <= 1,
			'variants' => count($signatures),
			'findings' => [count($signatures) <= 1
				? $this->finding('ok', 'DNS', $this->l->t('Every resolver asked returned the same answer.'))
				: $this->finding('warn', 'DNS', $this->l->t('The resolvers do not agree — %d different answers. A recent change may still be propagating, or one server is stale.', [count($signatures)]))],
		];
	}

	/**
	 * Follow the delegation from the root down to the name, the way a resolver
	 * does, so a broken hand-off between zones is visible.
	 *
	 * @return array<string, mixed>
	 */
	public function trace(string $name, string $type = 'A', float $timeout = 4.0): array {
		$name = $this->tools->validateDnsName($name);
		$type = strtoupper($type);
		$typeId = self::TYPES[$type] ?? 1;
		$steps = [];
		$server = array_key_first(self::ROOTS);
		$serverName = self::ROOTS[$server];

		for ($depth = 0; $depth < 12; $depth++) {
			$answer = $this->ask($server, $name, $typeId, false, $timeout, false);
			$step = [
				'server' => $server,
				'serverName' => $serverName,
				'status' => $answer['status'],
				'answers' => $answer['answers'],
				'authority' => $answer['authority'],
				'ms' => $answer['ms'] ?? null,
			];
			$steps[] = $step;
			if ($answer['answers'] !== [] || $answer['status'] !== 'NOERROR') {
				break;
			}
			// Follow the delegation: an NS in the authority section, resolved
			// through the glue when the additional section carries it.
			$next = null;
			$nextName = null;
			foreach ($answer['authority'] as $record) {
				if ($record['type'] !== 'NS') {
					continue;
				}
				$nextName = $record['value'];
				foreach ($answer['additional'] as $glue) {
					if ($glue['type'] === 'A' && strcasecmp($glue['name'], $nextName) === 0) {
						$next = $glue['value'];
						break 2;
					}
				}
			}
			if ($next === null && $nextName !== null) {
				$resolved = @dns_get_record($nextName, DNS_A);
				$next = is_array($resolved) && $resolved !== [] ? ($resolved[0]['ip'] ?? null) : null;
			}
			if ($next === null) {
				break;
			}
			$server = $next;
			$serverName = $nextName ?? $next;
		}

		return ['name' => $name, 'type' => $type, 'steps' => $steps];
	}

	/**
	 * Zone transfers should be refused to strangers: a server that hands over
	 * its whole zone gives away every host name it knows.
	 *
	 * @return array<string, mixed>
	 */
	public function zoneTransfer(string $zone, ?string $nameserver = null, float $timeout = 6.0): array {
		$zone = $this->tools->validateDnsName($zone);
		$servers = [];
		if ($nameserver !== null && $nameserver !== '') {
			$servers[] = $nameserver;
		} else {
			foreach (@dns_get_record($zone, DNS_NS) ?: [] as $record) {
				if (!empty($record['target'])) {
					$servers[] = (string)$record['target'];
				}
			}
		}
		if ($servers === []) {
			throw new \InvalidArgumentException('No name server found for ' . $zone);
		}

		$results = [];
		$findings = [];
		foreach (array_slice($servers, 0, 6) as $server) {
			$address = $this->resolverAddress($server);
			if ($address === null) {
				$results[] = ['server' => $server, 'address' => null, 'allowed' => null, 'records' => 0, 'error' => 'Could not resolve'];
				continue;
			}
			$outcome = $this->axfr($address, $zone, $timeout);
			$results[] = ['server' => $server, 'address' => $address] + $outcome;
			if ($outcome['allowed'] === true) {
				$findings[] = $this->finding('bad', 'Zone transfer', $this->l->t('%s hands its whole zone to anyone who asks (%d records). Restrict AXFR to your secondary servers.', [$server, $outcome['records']]));
			}
		}
		if ($findings === []) {
			$findings[] = $this->finding('ok', 'Zone transfer', $this->l->t('No name server allowed a zone transfer, which is correct.'));
		}
		return ['zone' => $zone, 'results' => $results, 'findings' => $findings];
	}

	/** @return array{allowed: bool|null, records: int, error: ?string, sample: list<string>} */
	private function axfr(string $address, string $zone, float $timeout): array {
		$errno = 0;
		$errstr = '';
		$target = str_contains($address, ':') ? '[' . $address . ']' : $address;
		$socket = @stream_socket_client('tcp://' . $target . ':53', $errno, $errstr, $timeout);
		if ($socket === false) {
			return ['allowed' => null, 'records' => 0, 'error' => $errstr ?: 'Could not connect', 'sample' => []];
		}
		stream_set_timeout($socket, (int)$timeout);
		$id = random_int(0, 0xffff);
		$query = pack('n6', $id, 0x0000, 1, 0, 0, 0) . $this->encodeName($zone) . pack('nn', 252, 1);
		@fwrite($socket, pack('n', strlen($query)) . $query);

		$records = 0;
		$sample = [];
		$error = null;
		$allowed = false;
		$deadline = microtime(true) + $timeout;
		while (microtime(true) < $deadline) {
			$lengthBytes = @fread($socket, 2);
			if (!is_string($lengthBytes) || strlen($lengthBytes) < 2) {
				break;
			}
			$length = unpack('n', $lengthBytes)[1];
			$message = '';
			while (strlen($message) < $length) {
				$chunk = @fread($socket, $length - strlen($message));
				if ($chunk === false || $chunk === '') {
					break 2;
				}
				$message .= $chunk;
			}
			$parsed = $this->parse($message);
			if ($parsed['status'] !== 'NOERROR') {
				$error = $parsed['status'];
				break;
			}
			$allowed = true;
			$records += count($parsed['answers']);
			foreach ($parsed['answers'] as $record) {
				if (count($sample) < 20) {
					$sample[] = $record['name'] . ' ' . $record['type'] . ' ' . $record['value'];
				}
			}
			// The transfer ends with the SOA it started with.
			if ($records > 1 && ($parsed['answers'][count($parsed['answers']) - 1]['type'] ?? '') === 'SOA') {
				break;
			}
			if ($records > 5000) {
				break;
			}
		}
		@fclose($socket);
		return ['allowed' => $allowed, 'records' => $records, 'error' => $error, 'sample' => $sample];
	}

	// ------------------------------------------------------------------ the wire

	/**
	 * Send one question and parse the reply. Falls back to TCP when the answer
	 * comes back truncated.
	 *
	 * @return array<string, mixed>
	 */
	private function ask(?string $server, string $name, int $type, bool $dnssec, float $timeout, bool $recursion = true): array {
		if ($server === null) {
			return $this->emptyAnswer('No resolver configured on this server');
		}
		$id = random_int(0, 0xffff);
		$flags = $recursion ? 0x0100 : 0x0000;
		$question = $this->encodeName($name) . pack('nn', $type, 1);
		$additional = '';
		$arCount = 0;
		if ($dnssec) {
			// An OPT record with the DO bit asks the resolver to validate.
			$additional = "\0" . pack('nnNn', 41, 4096, 0x00008000, 0);
			$arCount = 1;
		}
		$packet = pack('n6', $id, $flags, 1, 0, 0, $arCount) . $question . $additional;

		$started = microtime(true);
		$response = $this->exchangeUdp($server, $packet, $timeout);
		if ($response !== null) {
			$parsed = $this->parse($response);
			if (($parsed['truncated'] ?? false) === true) {
				$response = $this->exchangeTcp($server, $packet, $timeout);
				if ($response !== null) {
					$parsed = $this->parse($response);
				}
			}
			$parsed['ms'] = round((microtime(true) - $started) * 1000, 1);
			return $parsed;
		}
		return $this->emptyAnswer('No answer from ' . $server);
	}

	private function exchangeUdp(string $server, string $packet, float $timeout): ?string {
		$target = str_contains($server, ':') ? '[' . $server . ']' : $server;
		$errno = 0;
		$errstr = '';
		$socket = @stream_socket_client('udp://' . $target . ':53', $errno, $errstr, $timeout);
		if ($socket === false) {
			return null;
		}
		stream_set_timeout($socket, (int)max(1, $timeout));
		@fwrite($socket, $packet);
		$response = @fread($socket, 8192);
		@fclose($socket);
		return is_string($response) && strlen($response) >= 12 ? $response : null;
	}

	private function exchangeTcp(string $server, string $packet, float $timeout): ?string {
		$target = str_contains($server, ':') ? '[' . $server . ']' : $server;
		$errno = 0;
		$errstr = '';
		$socket = @stream_socket_client('tcp://' . $target . ':53', $errno, $errstr, $timeout);
		if ($socket === false) {
			return null;
		}
		stream_set_timeout($socket, (int)max(1, $timeout));
		@fwrite($socket, pack('n', strlen($packet)) . $packet);
		$lengthBytes = @fread($socket, 2);
		if (!is_string($lengthBytes) || strlen($lengthBytes) < 2) {
			@fclose($socket);
			return null;
		}
		$length = unpack('n', $lengthBytes)[1];
		$message = '';
		while (strlen($message) < $length) {
			$chunk = @fread($socket, $length - strlen($message));
			if ($chunk === false || $chunk === '') {
				break;
			}
			$message .= $chunk;
		}
		@fclose($socket);
		return $message !== '' ? $message : null;
	}

	/** @return array<string, mixed> */
	private function parse(string $packet): array {
		$header = unpack('nid/nflags/nqd/nan/nns/nar', substr($packet, 0, 12));
		if (!is_array($header)) {
			return $this->emptyAnswer('Malformed reply');
		}
		$flags = $header['flags'];
		$offset = 12;
		$questions = [];
		for ($i = 0; $i < $header['qd']; $i++) {
			[$qname, $offset] = $this->decodeName($packet, $offset);
			$fields = unpack('ntype/nclass', substr($packet, $offset, 4));
			$offset += 4;
			$questions[] = ['name' => $qname, 'type' => $this->typeName((int)$fields['type'])];
		}
		$sections = ['answers' => $header['an'], 'authority' => $header['ns'], 'additional' => $header['ar']];
		$out = ['answers' => [], 'authority' => [], 'additional' => []];
		foreach ($sections as $section => $count) {
			for ($i = 0; $i < $count; $i++) {
				if ($offset + 1 > strlen($packet)) {
					break 2;
				}
				[$rname, $offset] = $this->decodeName($packet, $offset);
				$fields = unpack('ntype/nclass/Nttl/nlength', substr($packet, $offset, 10));
				if (!is_array($fields)) {
					break 2;
				}
				$offset += 10;
				$rdata = substr($packet, $offset, (int)$fields['length']);
				$record = [
					'name' => $rname,
					'type' => $this->typeName((int)$fields['type']),
					'ttl' => (int)$fields['ttl'],
					'value' => $this->decodeRdata($packet, $offset, (int)$fields['type'], $rdata),
				];
				$offset += (int)$fields['length'];
				// An OPT record is transport metadata, not an answer.
				if ((int)$fields['type'] !== 41) {
					$out[$section][] = $record;
				}
			}
		}

		return [
			'status' => self::RCODES[$flags & 0x0f] ?? ('RCODE' . ($flags & 0x0f)),
			'authoritative' => (bool)($flags & 0x0400),
			'truncated' => (bool)($flags & 0x0200),
			'recursionAvailable' => (bool)($flags & 0x0080),
			'authenticated' => (bool)($flags & 0x0020),
			'questions' => $questions,
			'answers' => $out['answers'],
			'authority' => $out['authority'],
			'additional' => $out['additional'],
			'error' => null,
		];
	}

	private function decodeRdata(string $packet, int $offset, int $type, string $rdata): string {
		switch ($type) {
			case 1:
				return strlen($rdata) === 4 ? implode('.', array_map('ord', str_split($rdata))) : '';
			case 28:
				return strlen($rdata) === 16 ? (string)inet_ntop($rdata) : '';
			case 2: case 5: case 12:
				return $this->decodeName($packet, $offset)[0];
			case 15:
				$priority = unpack('n', substr($rdata, 0, 2))[1] ?? 0;
				return $priority . ' ' . $this->decodeName($packet, $offset + 2)[0];
			case 16: case 99:
				$text = '';
				$position = 0;
				while ($position < strlen($rdata)) {
					$length = ord($rdata[$position]);
					$text .= substr($rdata, $position + 1, $length);
					$position += $length + 1;
				}
				return $text;
			case 6:
				[$mname, $next] = $this->decodeName($packet, $offset);
				[$rname, $next] = $this->decodeName($packet, $next);
				$numbers = unpack('Nserial/Nrefresh/Nretry/Nexpire/Nminimum', substr($packet, $next, 20));
				return sprintf('%s %s serial=%d refresh=%d retry=%d expire=%d min=%d', $mname, $rname,
					$numbers['serial'] ?? 0, $numbers['refresh'] ?? 0, $numbers['retry'] ?? 0, $numbers['expire'] ?? 0, $numbers['minimum'] ?? 0);
			case 33:
				$fields = unpack('npriority/nweight/nport', substr($rdata, 0, 6));
				return sprintf('%d %d %d %s', $fields['priority'] ?? 0, $fields['weight'] ?? 0, $fields['port'] ?? 0, $this->decodeName($packet, $offset + 6)[0]);
			case 257:
				$flags = ord($rdata[0] ?? "\0");
				$tagLength = ord($rdata[1] ?? "\0");
				return sprintf('%d %s "%s"', $flags, substr($rdata, 2, $tagLength), substr($rdata, 2 + $tagLength));
			case 52:
				return sprintf('%d %d %d %s', ord($rdata[0] ?? "\0"), ord($rdata[1] ?? "\0"), ord($rdata[2] ?? "\0"), bin2hex(substr($rdata, 3)));
			case 44:
				return sprintf('%d %d %s', ord($rdata[0] ?? "\0"), ord($rdata[1] ?? "\0"), bin2hex(substr($rdata, 2)));
			case 43:
				$fields = unpack('nkeytag/Calgorithm/Cdigest', substr($rdata, 0, 4));
				return sprintf('%d %d %d %s', $fields['keytag'] ?? 0, $fields['algorithm'] ?? 0, $fields['digest'] ?? 0, bin2hex(substr($rdata, 4)));
			case 48:
				$fields = unpack('nflags/Cprotocol/Calgorithm', substr($rdata, 0, 4));
				return sprintf('%d %d %d %s…', $fields['flags'] ?? 0, $fields['protocol'] ?? 0, $fields['algorithm'] ?? 0, substr(base64_encode(substr($rdata, 4)), 0, 32));
			case 64: case 65:
				$priority = unpack('n', substr($rdata, 0, 2))[1] ?? 0;
				return $priority . ' ' . $this->decodeName($packet, $offset + 2)[0] . ' …';
			default:
				return bin2hex($rdata);
		}
	}

	/** @return array{0: string, 1: int} */
	private function decodeName(string $packet, int $offset): array {
		$labels = [];
		$jumped = false;
		$next = $offset;
		$guard = 0;
		while ($offset < strlen($packet) && $guard++ < 128) {
			$length = ord($packet[$offset]);
			if ($length === 0) {
				$offset++;
				if (!$jumped) {
					$next = $offset;
				}
				break;
			}
			if (($length & 0xc0) === 0xc0) {
				$pointer = (($length & 0x3f) << 8) | ord($packet[$offset + 1] ?? "\0");
				if (!$jumped) {
					$next = $offset + 2;
				}
				$offset = $pointer;
				$jumped = true;
				continue;
			}
			$labels[] = substr($packet, $offset + 1, $length);
			$offset += $length + 1;
			if (!$jumped) {
				$next = $offset;
			}
		}
		return [$labels === [] ? '.' : implode('.', $labels), $next];
	}

	private function encodeName(string $name): string {
		$encoded = '';
		foreach (explode('.', rtrim($name, '.')) as $label) {
			$label = substr($label, 0, 63);
			$encoded .= chr(strlen($label)) . $label;
		}
		return $encoded . "\0";
	}

	private function typeName(int $type): string {
		$byId = array_flip(self::TYPES);
		return $byId[$type] ?? ('TYPE' . $type);
	}

	/** @return array<string, mixed> */
	private function emptyAnswer(string $error): array {
		return [
			'status' => 'NOANSWER', 'authoritative' => false, 'truncated' => false,
			'recursionAvailable' => false, 'authenticated' => false, 'questions' => [],
			'answers' => [], 'authority' => [], 'additional' => [], 'error' => $error, 'ms' => null,
		];
	}

	/** An address for a resolver given as an address or a name. */
	private function resolverAddress(string $server): ?string {
		$server = trim($server);
		if (filter_var($server, FILTER_VALIDATE_IP) !== false) {
			return $server;
		}
		$server = $this->tools->validateHost($server);
		$resolved = @dns_get_record($server, DNS_A);
		if (is_array($resolved) && $resolved !== [] && !empty($resolved[0]['ip'])) {
			return (string)$resolved[0]['ip'];
		}
		$address = @gethostbyname($server);
		return $address !== $server ? $address : null;
	}

	public function systemResolver(): ?string {
		if (is_readable('/etc/resolv.conf')) {
			foreach (explode("\n", (string)file_get_contents('/etc/resolv.conf')) as $line) {
				if (preg_match('/^\s*nameserver\s+(\S+)/', $line, $m) && filter_var($m[1], FILTER_VALIDATE_IP) !== false) {
					return $m[1];
				}
			}
		}
		return null;
	}

	/** @return array<string, string> */
	private function finding(string $level, string $area, string $text): array {
		return ['level' => $level, 'area' => $area, 'text' => $text];
	}
}
