<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\IL10N;
use Psr\Log\LoggerInterface;

/**
 * Privilege-free LAN discovery.
 *
 * Nextcloud runs unprivileged, so raw sockets (and therefore ARP or SYN
 * scanning in PHP) are not available. Instead we make the kernel do the ARP
 * work for us: sending a datagram to an on-link address forces the kernel to
 * resolve it, and the result lands in the neighbour table, which is world
 * readable. Names then come from the devices themselves over NetBIOS, mDNS,
 * WS-Discovery and SSDP — all plain UDP, all unprivileged.
 */
class DiscoveryService {
	/** Ports probed to tell what a device is; kept short so a sweep stays fast. */
	public const FINGERPRINT_PORTS = [22, 23, 53, 80, 139, 443, 445, 515, 554, 631, 3389, 5000, 8080, 8443, 9100];

	public function __construct(
		private OuiService $oui,
		private LoggerInterface $logger,
	) {
	}

	// ---------------------------------------------------------------- interfaces

	/**
	 * Network interfaces of this server with their IPv4 networks.
	 *
	 * @return list<array{name: string, up: bool, mac: string, loopback: bool, addresses: list<array{ip: string, netmask: string, cidr: int, network: string, family: string}>}>
	 */
	public function interfaces(): array {
		$out = [];
		$raw = @net_get_interfaces();
		if ($raw === false) {
			return $out;
		}
		foreach ($raw as $name => $data) {
			$addresses = [];
			foreach (($data['unicast'] ?? []) as $addr) {
				$ip = $addr['address'] ?? '';
				if ($ip === '') {
					continue;
				}
				// AF_INET6 is an ext-sockets constant and the numeric value differs
				// between platforms, so read the family off the address itself.
				$family = str_contains($ip, ':') ? 'inet6' : 'inet';
				$netmask = (string)($addr['netmask'] ?? '');
				$cidr = $family === 'inet' ? $this->maskToCidr($netmask) : (int)($addr['prefixlen'] ?? 64);
				$addresses[] = [
					'ip' => $ip,
					'netmask' => $netmask,
					'cidr' => $cidr,
					'network' => $family === 'inet' ? $this->networkOf($ip, $cidr) : '',
					'family' => $family,
				];
			}
			$out[] = [
				'name' => (string)$name,
				'up' => (bool)($data['up'] ?? false),
				'mac' => $this->readSys($name, 'address'),
				'loopback' => (bool)($data['loopback'] ?? ($name === 'lo')),
				'index' => (int)($this->readSys($name, 'ifindex') ?: 0),
				'speed' => $this->readSys($name, 'speed'),
				'mtu' => (int)($this->readSys($name, 'mtu') ?: 0),
				'addresses' => $addresses,
			];
		}
		return $out;
	}

	/** The interface carrying the default route, if it can be determined. */
	public function defaultRoute(): array {
		$route = ['interface' => '', 'gateway' => ''];
		foreach (@file('/proc/net/route') ?: [] as $i => $line) {
			if ($i === 0) {
				continue;
			}
			$f = preg_split('/\s+/', trim($line));
			if (count($f) < 3 || $f[1] !== '00000000') {
				continue;
			}
			$route['interface'] = $f[0];
			$gw = str_pad($f[2], 8, '0', STR_PAD_LEFT);
			$route['gateway'] = implode('.', array_map('hexdec', array_reverse(str_split($gw, 2))));
			break;
		}
		return $route;
	}

	/**
	 * Interfaces that belong to container and VM plumbing rather than to a
	 * real network. Their subnets are usually a /16 of nothing, so offering
	 * them as a default scan target only wastes a sweep.
	 */
	public const VIRTUAL_INTERFACES = '/^(docker|podman|virbr|br-|veth|tun|tap|wg|zt|tailscale|cni|flannel|kube|lxcbr|vmnet|utun)/i';

	/** The LAN networks NetBase will scan when the user does not name a target. */
	public function suggestedTargets(): array {
		$targets = [];
		foreach ($this->interfaces() as $if) {
			if ($if['loopback'] || !$if['up'] || preg_match(self::VIRTUAL_INTERFACES, $if['name'])) {
				continue;
			}
			foreach ($if['addresses'] as $addr) {
				if ($addr['family'] !== 'inet' || $addr['cidr'] < 8 || $addr['cidr'] > 30) {
					continue;
				}
				$targets[] = [
					'cidr' => $addr['network'] . '/' . $addr['cidr'],
					'interface' => $if['name'],
					'address' => $addr['ip'],
					'hosts' => max(0, (1 << (32 - $addr['cidr'])) - 2),
				];
			}
		}
		return $targets;
	}

	/**
	 * The kernel's neighbour-table limits.
	 *
	 * A sweep creates one neighbour entry per probed address. Push past
	 * gc_thresh3 and the kernel starts forcing garbage collection, which logs
	 * "neighbour table overflow" and can evict entries that are still in use —
	 * including the default gateway. NetBase reads these values so it can pace
	 * itself instead of relying on the operator to know about them.
	 *
	 * @return array{gc1: int, gc2: int, gc3: int}
	 */
	public function neighbourLimits(): array {
		$read = static function (string $name, int $fallback): int {
			$value = @file_get_contents('/proc/sys/net/ipv4/neigh/default/' . $name);
			$value = is_string($value) ? (int)trim($value) : 0;
			return $value > 0 ? $value : $fallback;
		};
		return [
			'gc1' => $read('gc_thresh1', 128),
			'gc2' => $read('gc_thresh2', 512),
			'gc3' => $read('gc_thresh3', 1024),
		];
	}

	// ---------------------------------------------------------------- neighbours

	/** Rows currently occupying the neighbour table, resolved or not. */
	public function neighbourCount(): int {
		$lines = @file('/proc/net/arp');
		return is_array($lines) ? max(0, count($lines) - 1) : 0;
	}

	/**
	 * The kernel neighbour (ARP) table, keyed by IPv4 address.
	 *
	 * @return array<string, array{mac: string, interface: string, flags: int}>
	 */
	public function neighbours(?string $interface = null): array {
		$out = [];
		$lines = @file('/proc/net/arp') ?: [];
		array_shift($lines);
		foreach ($lines as $line) {
			$f = preg_split('/\s+/', trim($line));
			if (count($f) < 6) {
				continue;
			}
			[$ip, , $flags, $mac, , $dev] = $f;
			if ($mac === '' || $mac === '00:00:00:00:00:00') {
				continue; // unresolved / failed entry
			}
			if ($interface !== null && $dev !== $interface) {
				continue;
			}
			$out[$ip] = ['mac' => strtolower($mac), 'interface' => $dev, 'flags' => (int)hexdec(ltrim($flags, '0x') ?: '0')];
		}
		return $out;
	}

	/**
	 * Force the kernel to resolve a list of on-link addresses.
	 *
	 * A datagram to a closed UDP port is enough: the kernel must know the MAC
	 * before it can send anything, so it emits an ARP request. Nothing is
	 * received and no port is touched on the target.
	 *
	 * @param list<string> $ips
	 * @return int packets emitted
	 */
	public function primeNeighbours(array $ips, int $ratePerSecond = 4000): int {
		$sent = 0;
		$batch = [];
		$batchSize = 256;
		$perBatchUs = $ratePerSecond > 0 ? (int)round($batchSize / $ratePerSecond * 1_000_000) : 0;

		foreach ($ips as $ip) {
			$sock = @stream_socket_client('udp://' . $ip . ':9', $errno, $errstr, 0.1, STREAM_CLIENT_ASYNC_CONNECT);
			if ($sock === false) {
				continue;
			}
			@fwrite($sock, "\0");
			$batch[] = $sock;
			$sent++;
			if (count($batch) >= $batchSize) {
				foreach ($batch as $s) {
					@fclose($s);
				}
				$batch = [];
				if ($perBatchUs > 0) {
					usleep($perBatchUs);
				}
			}
		}
		foreach ($batch as $s) {
			@fclose($s);
		}
		return $sent;
	}

	// ---------------------------------------------------------------- name probes

	/**
	 * NetBIOS node status (UDP 137) — the name a Windows or Samba host calls itself.
	 *
	 * @param list<string> $ips
	 * @return array<string, array{host: string, workgroup: string, mac: string}>
	 */
	public function netbios(array $ips, float $wait = 1.0): array {
		// Wildcard name '*' padded to 16 bytes, in first-level encoding.
		$encoded = '';
		foreach (str_split(str_pad('*', 16, "\x00")) as $ch) {
			$b = ord($ch);
			$encoded .= chr(65 + (($b >> 4) & 0xF)) . chr(65 + ($b & 0xF));
		}
		$query = "\x4e\x42\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00" . chr(32) . $encoded . "\x00\x00\x21\x00\x01";

		$result = [];
		foreach ($this->askUdp($ips, 137, $query, $wait) as $ip => $payloads) {
			foreach ($payloads as $payload) {
				$names = strlen($payload) > 56 ? $this->parseNbstat($payload) : null;
				if ($names !== null) {
					$result[$ip] = $names;
					break;
				}
			}
		}
		return $result;
	}

	/**
	 * Send one datagram to every address and collect whatever comes back.
	 *
	 * This deliberately uses stream sockets rather than ext-sockets: the
	 * extension is missing from plenty of PHP builds (including the official
	 * Nextcloud container images), and name discovery is too central to lose
	 * there. Only multicast needs the extension, because choosing the outgoing
	 * interface has no stream equivalent.
	 *
	 * @param list<string> $ips
	 * @return array<string, list<string>>
	 */
	private function askUdp(array $ips, int $port, string $payload, float $wait): array {
		$sock = @stream_socket_server('udp://0.0.0.0:0', $errno, $errstr, STREAM_SERVER_BIND);
		if ($sock === false) {
			return [];
		}
		stream_set_blocking($sock, false);
		foreach ($ips as $ip) {
			@stream_socket_sendto($sock, $payload, 0, $ip . ':' . $port);
		}

		$result = [];
		$deadline = microtime(true) + $wait;
		while (microtime(true) < $deadline) {
			$peer = '';
			$data = @stream_socket_recvfrom($sock, 8192, 0, $peer);
			if ($data !== false && $data !== '') {
				$ip = strstr($peer, ':', true);
				if ($ip !== false && $ip !== '') {
					$result[$ip][] = $data;
				}
				continue;
			}
			$read = [$sock];
			$write = null;
			$except = null;
			@stream_select($read, $write, $except, 0, 20000);
		}
		fclose($sock);
		return $result;
	}

	/** @return array{host: string, workgroup: string, mac: string}|null */
	private function parseNbstat(string $buf): ?array {
		$count = ord($buf[56]);
		if ($count === 0 || $count > 64) {
			return null;
		}
		$host = '';
		$workgroup = '';
		for ($i = 0; $i < $count; $i++) {
			$off = 57 + $i * 18;
			if ($off + 18 > strlen($buf)) {
				break;
			}
			$name = rtrim(substr($buf, $off, 15));
			$type = ord($buf[$off + 15]);
			$flags = (ord($buf[$off + 16]) << 8) | ord($buf[$off + 17]);
			$group = (bool)($flags & 0x8000);
			if (!$group && $type === 0x00 && $host === '') {
				$host = $name;
			}
			if ($group && $type === 0x00 && $workgroup === '') {
				$workgroup = $name;
			}
		}
		$mac = '';
		$macOff = 57 + $count * 18;
		if ($macOff + 6 <= strlen($buf)) {
			$mac = implode(':', array_map(static fn ($b) => sprintf('%02x', ord($b)), str_split(substr($buf, $macOff, 6))));
			if ($mac === '00:00:00:00:00:00') {
				$mac = '';
			}
		}
		if ($host === '' && $workgroup === '') {
			return null;
		}
		return ['host' => $host, 'workgroup' => $workgroup, 'mac' => $mac];
	}

	/**
	 * mDNS reverse lookup (UDP 5353) — the .local name of Apple, Android,
	 * printer and IoT devices.
	 *
	 * @param list<string> $ips
	 * @return array<string, string>
	 */
	public function mdns(array $ips, float $wait = 1.2): array {
		$result = [];
		foreach ($ips as $ip) {
			$labels = array_merge(array_reverse(explode('.', $ip)), ['in-addr', 'arpa']);
			$qname = '';
			foreach ($labels as $label) {
				$qname .= chr(strlen($label)) . $label;
			}
			$qname .= "\x00";
			// QU bit set so the device answers us directly rather than to the group.
			$queries[$ip] = "\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00" . $qname . "\x00\x0c\x80\x01";
		}
		foreach ($this->askUdpPerHost($queries ?? [], 5353, $wait) as $ip => $payloads) {
			foreach ($payloads as $payload) {
				$name = $this->firstPtrName($payload);
				if ($name !== '') {
					$result[$ip] = $name;
					break;
				}
			}
		}
		return $result;
	}

	/**
	 * Like askUdp(), but each address gets its own payload — a reverse DNS
	 * query only makes sense for the address it names.
	 *
	 * @param array<string, string> $queries
	 * @return array<string, list<string>>
	 */
	private function askUdpPerHost(array $queries, int $port, float $wait): array {
		$sock = @stream_socket_server('udp://0.0.0.0:0', $errno, $errstr, STREAM_SERVER_BIND);
		if ($sock === false) {
			return [];
		}
		stream_set_blocking($sock, false);
		foreach ($queries as $ip => $payload) {
			@stream_socket_sendto($sock, $payload, 0, $ip . ':' . $port);
		}

		$result = [];
		$deadline = microtime(true) + $wait;
		while (microtime(true) < $deadline) {
			$peer = '';
			$data = @stream_socket_recvfrom($sock, 8192, 0, $peer);
			if ($data !== false && $data !== '') {
				$ip = strstr($peer, ':', true);
				if ($ip !== false && $ip !== '') {
					$result[$ip][] = $data;
				}
				continue;
			}
			$read = [$sock];
			$write = null;
			$except = null;
			@stream_select($read, $write, $except, 0, 20000);
		}
		fclose($sock);
		return $result;
	}

	/** Decode the first PTR answer of a DNS/mDNS response. */
	private function firstPtrName(string $buf): string {
		if (strlen($buf) < 12) {
			return '';
		}
		$answers = (ord($buf[6]) << 8) | ord($buf[7]);
		if ($answers < 1) {
			return '';
		}
		$off = 12;
		$questions = (ord($buf[4]) << 8) | ord($buf[5]);
		for ($q = 0; $q < $questions; $q++) {
			$off = $this->skipName($buf, $off);
			$off += 4;
		}
		$off = $this->skipName($buf, $off);
		if ($off + 10 > strlen($buf)) {
			return '';
		}
		$type = (ord($buf[$off]) << 8) | ord($buf[$off + 1]);
		$off += 8;
		$rdlen = (ord($buf[$off]) << 8) | ord($buf[$off + 1]);
		$off += 2;
		if ($type !== 12 || $rdlen < 1) {
			return '';
		}
		return $this->readName($buf, $off);
	}

	private function skipName(string $buf, int $off): int {
		$guard = 0;
		while ($off < strlen($buf) && $guard++ < 128) {
			$len = ord($buf[$off]);
			if ($len === 0) {
				return $off + 1;
			}
			if (($len & 0xC0) === 0xC0) {
				return $off + 2;
			}
			$off += $len + 1;
		}
		return $off;
	}

	private function readName(string $buf, int $off): string {
		$name = '';
		$guard = 0;
		while ($off < strlen($buf) && $guard++ < 128) {
			$len = ord($buf[$off]);
			if ($len === 0) {
				break;
			}
			if (($len & 0xC0) === 0xC0) {
				if ($off + 1 >= strlen($buf)) {
					break;
				}
				$off = (($len & 0x3F) << 8) | ord($buf[$off + 1]);
				continue;
			}
			$name .= substr($buf, $off + 1, $len) . '.';
			$off += $len + 1;
		}
		return rtrim($name, '.');
	}

	/**
	 * WS-Discovery probe (UDP 3702, multicast) — modern Windows machines and
	 * network printers answer this even with NetBIOS switched off.
	 *
	 * @return array<string, array{types: string, xaddrs: string}>
	 */
	public function wsDiscovery(int $ifIndex, string $sourceIp, float $wait = 2.0): array {
		$uuid = sprintf('urn:uuid:%s', $this->uuid4());
		$probe = '<?xml version="1.0" encoding="utf-8"?>'
			. '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"'
			. ' xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"'
			. ' xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery">'
			. '<soap:Header><wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>'
			. '<wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>'
			. '<wsa:MessageID>' . $uuid . '</wsa:MessageID></soap:Header>'
			. '<soap:Body><wsd:Probe/></soap:Body></soap:Envelope>';

		$result = [];
		foreach ($this->multicastAsk($ifIndex, $sourceIp, '239.255.255.250', 3702, $probe, $wait) as $ip => $payloads) {
			$body = implode("\n", $payloads);
			$types = preg_match('#<[^>]*Types[^>]*>(.*?)</[^>]*Types>#s', $body, $m) ? trim($m[1]) : '';
			$xaddrs = preg_match('#<[^>]*XAddrs[^>]*>(.*?)</[^>]*XAddrs>#s', $body, $m) ? trim($m[1]) : '';
			$result[$ip] = ['types' => $types, 'xaddrs' => $xaddrs];
		}
		return $result;
	}

	/**
	 * SSDP / UPnP search (UDP 1900, multicast) — routers, NAS boxes, TVs and
	 * media devices announce a description URL here.
	 *
	 * @return array<string, array{server: string, location: string, st: string}>
	 */
	public function ssdp(int $ifIndex, string $sourceIp, float $wait = 2.0): array {
		$search = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n";
		$result = [];
		foreach ($this->multicastAsk($ifIndex, $sourceIp, '239.255.255.250', 1900, $search, $wait) as $ip => $payloads) {
			$body = implode("\n", $payloads);
			$result[$ip] = [
				'server' => preg_match('/^SERVER:\s*(.+)$/mi', $body, $m) ? trim($m[1]) : '',
				'location' => preg_match('/^LOCATION:\s*(\S+)/mi', $body, $m) ? trim($m[1]) : '',
				'st' => preg_match('/^ST:\s*(\S+)/mi', $body, $m) ? trim($m[1]) : '',
			];
		}
		return $result;
	}

	/**
	 * Send a multicast request out of one interface and collect every reply.
	 *
	 * @return array<string, list<string>>
	 */
	private function multicastAsk(int $ifIndex, string $sourceIp, string $group, int $port, string $payload, float $wait): array {
		if (!$this->hasSockets()) {
			// Picking the outgoing interface for a multicast datagram has no
			// stream-socket equivalent, so this discovery method simply does
			// not run without ext-sockets. Everything else still does.
			return [];
		}
		$sock = @socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
		if ($sock === false) {
			return [];
		}
		socket_set_nonblock($sock);
		@socket_bind($sock, $sourceIp, 0);
		@socket_set_option($sock, IPPROTO_IP, IP_MULTICAST_TTL, 2);
		if ($ifIndex > 0) {
			// PHP expects the interface *index* here, not its address.
			@socket_set_option($sock, IPPROTO_IP, IP_MULTICAST_IF, $ifIndex);
		}
		for ($i = 0; $i < 2; $i++) {
			@socket_sendto($sock, $payload, strlen($payload), 0, $group, $port);
			usleep(150000);
		}

		$result = [];
		$deadline = microtime(true) + $wait;
		while (microtime(true) < $deadline) {
			$buf = '';
			$from = '';
			$fromPort = 0;
			if (@socket_recvfrom($sock, $buf, 8192, 0, $from, $fromPort) > 0) {
				$result[$from][] = $buf;
			} else {
				usleep(3000);
			}
		}
		socket_close($sock);
		return $result;
	}

	// ---------------------------------------------------------------- tcp probing

	/**
	 * Non-blocking TCP connect sweep. Every (host, port) pair is opened at
	 * once and polled together, so the whole sweep costs one timeout.
	 *
	 * @param list<string> $ips
	 * @param list<int> $ports
	 * @return array<string, list<int>> open ports per address
	 */
	public function tcpSweep(array $ips, array $ports, float $timeout = 0.6, int $maxSockets = 512): array {
		$open = [];
		$pairs = [];
		foreach ($ips as $ip) {
			foreach ($ports as $port) {
				$pairs[] = [$ip, $port];
			}
		}
		foreach (array_chunk($pairs, $maxSockets) as $chunk) {
			$pending = [];
			foreach ($chunk as [$ip, $port]) {
				$target = str_contains($ip, ':') ? '[' . $ip . ']' : $ip;
				$sock = @stream_socket_client(
					'tcp://' . $target . ':' . $port,
					$errno,
					$errstr,
					$timeout,
					STREAM_CLIENT_ASYNC_CONNECT | STREAM_CLIENT_CONNECT
				);
				if ($sock !== false) {
					$pending[] = ['sock' => $sock, 'ip' => $ip, 'port' => $port];
				}
			}
			$deadline = microtime(true) + $timeout;
			while ($pending !== [] && microtime(true) < $deadline) {
				$write = array_column($pending, 'sock');
				$read = null;
				$except = $write;
				$remain = max(0.0, $deadline - microtime(true));
				$ready = @stream_select($read, $write, $except, 0, (int)($remain * 1_000_000));
				if ($ready === false || $ready === 0) {
					break;
				}
				foreach ($pending as $key => $entry) {
					if (!in_array($entry['sock'], $write, true) && !in_array($entry['sock'], $except, true)) {
						continue;
					}
					$name = @stream_socket_get_name($entry['sock'], true);
					if ($name !== false && $name !== '') {
						$open[$entry['ip']][] = $entry['port'];
					}
					@fclose($entry['sock']);
					unset($pending[$key]);
				}
				$pending = array_values($pending);
			}
			foreach ($pending as $entry) {
				@fclose($entry['sock']);
			}
		}
		foreach ($open as $ip => $ports2) {
			sort($ports2);
			$open[$ip] = array_values(array_unique($ports2));
		}
		return $open;
	}

	/** Reverse DNS for a batch of addresses, with the resolver timeout kept short. */
	public function reverseDns(array $ips, float $timeout = 0.4): array {
		$result = [];
		foreach ($ips as $ip) {
			$name = @gethostbyaddr($ip);
			if (is_string($name) && $name !== '' && $name !== $ip) {
				$result[$ip] = $name;
			}
		}
		return $result;
	}

	/** ext-sockets is optional; only multicast discovery depends on it. */
	public function hasSockets(): bool {
		return extension_loaded('sockets') && function_exists('socket_create');
	}

	// ---------------------------------------------------------------- helpers

	/** Expand a CIDR block into its usable host addresses. */
	public function expandCidr(string $cidr, int $limit = 65536): array {
		if (!str_contains($cidr, '/')) {
			return filter_var($cidr, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) ? [$cidr] : [];
		}
		[$net, $bits] = explode('/', $cidr, 2);
		$bits = (int)$bits;
		if (!filter_var($net, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) || $bits < 8 || $bits > 32) {
			return [];
		}
		$base = ip2long($net) & (-1 << (32 - $bits));
		$size = 1 << (32 - $bits);
		$first = $size > 2 ? 1 : 0;
		$last = $size > 2 ? $size - 1 : $size;
		$ips = [];
		for ($i = $first; $i < $last && count($ips) < $limit; $i++) {
			$ips[] = long2ip($base + $i);
		}
		return $ips;
	}

	public function maskToCidr(string $netmask): int {
		$long = ip2long($netmask);
		if ($long === false) {
			return 0;
		}
		return substr_count(decbin($long & 0xFFFFFFFF), '1');
	}

	public function networkOf(string $ip, int $cidr): string {
		$long = ip2long($ip);
		if ($long === false || $cidr < 0 || $cidr > 32) {
			return $ip;
		}
		return long2ip($long & (-1 << (32 - $cidr)));
	}

	private function readSys(string $interface, string $file): string {
		$safe = preg_replace('/[^A-Za-z0-9_.:-]/', '', $interface) ?? '';
		$path = '/sys/class/net/' . $safe . '/' . $file;
		$value = @file_get_contents($path);
		return is_string($value) ? trim($value) : '';
	}

	private function uuid4(): string {
		$data = random_bytes(16);
		$data[6] = chr(ord($data[6]) & 0x0f | 0x40);
		$data[8] = chr(ord($data[8]) & 0x3f | 0x80);
		return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
	}
}
