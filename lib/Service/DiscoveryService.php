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

	/**
	 * The longer list, for when the short one leaves a device unexplained.
	 *
	 * Everything here answers on TCP and says something about what a machine
	 * is: web and management interfaces, remote access, file and mail service,
	 * databases, printers, cameras and the ports appliances tend to sit on. It
	 * is roughly seven times the work of the short list, which is why it is a
	 * choice and not the default.
	 */
	public const DETAILED_PORTS = [
		7, 9, 13, 21, 22, 23, 25, 26, 37, 53, 79, 80, 81, 88, 106, 110, 111, 113, 119, 135, 139, 143,
		179, 199, 389, 427, 443, 444, 445, 465, 513, 514, 515, 543, 544, 548, 554, 587, 631, 636, 873,
		990, 993, 995, 1025, 1080, 1194, 1433, 1521, 1723, 1883, 2000, 2049, 2121, 2181, 2222, 2375,
		3000, 3128, 3260, 3268, 3306, 3389, 4444, 4899, 5000, 5001, 5060, 5222, 5357, 5432, 5555, 5601,
		5666, 5800, 5900, 5901, 5985, 6000, 6379, 6667, 7070, 7443, 8000, 8008, 8009, 8080, 8081, 8088,
		8443, 8554, 8888, 9000, 9080, 9090, 9100, 9200, 9443, 9999, 10000, 11211, 27017, 32400, 49152,
		49153, 49154,
	];

	public function __construct(
		private OuiService $oui,
		private LoggerInterface $logger,
		private ExecService $exec,
	) {
	}

	/** Neighbour states (from `ip neigh`) that mean the device is present now.
	 *  STALE/FAILED/INCOMPLETE mean the kernel has not confirmed it lately — a
	 *  powered-off device lingers as STALE with its old MAC, so those must not
	 *  count as online. */
	private const REACHABLE_STATES = ['REACHABLE', 'PERMANENT', 'NOARP'];
	private const NUD_STATES = ['REACHABLE', 'STALE', 'DELAY', 'PROBE', 'PERMANENT', 'NOARP', 'FAILED', 'INCOMPLETE', 'NONE'];

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
	 * The networks this server routes through a router, in preference order —
	 * the first is the primary (the default route with the lowest metric), the
	 * rest are secondaries of a redundant / multi-homed setup. A subnet that is
	 * only directly attached with no gateway (a container bridge like podman0,
	 * or an unused address) is deliberately NOT here: it is a separate network,
	 * not one of the system's routed ones.
	 *
	 * @return list<array{cidr: string, interface: string, gateway: string, metric: int}>
	 */
	public function routedNetworks(): array {
		$lines = @file('/proc/net/route') ?: [];
		array_shift($lines);
		$toIp = static function (string $hex): string {
			$hex = str_pad($hex, 8, '0', STR_PAD_LEFT);
			return implode('.', array_map('hexdec', array_reverse(str_split($hex, 2))));
		};
		$maskBits = static function (string $hex): int {
			$n = (int)hexdec($hex);
			$c = 0;
			while ($n) { $c += $n & 1; $n >>= 1; }
			return $c;
		};
		$defaults = [];
		$connected = [];
		foreach ($lines as $line) {
			$f = preg_split('/\s+/', trim($line));
			if (count($f) < 8) {
				continue;
			}
			[$iface, $dest, $gw] = [$f[0], $f[1], $f[2]];
			$metric = (int)$f[6];
			$mask = $f[7];
			if ($dest === '00000000' && $mask === '00000000') {
				if ($gw !== '00000000') {
					$defaults[] = ['iface' => $iface, 'gateway' => $toIp($gw), 'metric' => $metric];
				}
			} elseif ($gw === '00000000') {
				$connected[] = ['iface' => $iface, 'network' => $toIp($dest), 'cidr' => $maskBits($mask)];
			}
		}
		usort($defaults, static fn (array $a, array $b): int => $a['metric'] <=> $b['metric']);
		$ipval = static fn (string $ip): int => (int)array_reduce(explode('.', $ip), static fn ($n, $o) => ($n * 256) + (int)$o, 0);
		$out = [];
		$seen = [];
		foreach ($defaults as $d) {
			$best = null;
			foreach ($connected as $c) {
				$mask = $c['cidr'] === 0 ? 0 : ((-1 << (32 - $c['cidr'])) & 0xFFFFFFFF);
				if (($ipval($c['network']) & $mask) === ($ipval($d['gateway']) & $mask)) {
					$best = $c;
					break;
				}
			}
			if ($best === null) {
				foreach ($connected as $c) {
					if ($c['iface'] === $d['iface']) { $best = $c; break; }
				}
			}
			if ($best === null) {
				continue;
			}
			$cidr = $best['network'] . '/' . $best['cidr'];
			if (isset($seen[$cidr])) {
				continue;
			}
			$seen[$cidr] = true;
			$out[] = ['cidr' => $cidr, 'interface' => $best['iface'], 'gateway' => $d['gateway'], 'metric' => $d['metric']];
		}
		return $out;
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

	/** The path of the administrator-installed ARP-flush helper. */
	public const ARP_FLUSH_HELPER = '/usr/local/sbin/netbase-arp-flush';

	/**
	 * Whether this server can clear the neighbour (ARP) table on request.
	 *
	 * NetBase runs unprivileged and the kernel will not let it flush neighbours,
	 * so an administrator installs a tiny root-owned helper and a sudoers rule
	 * that lets the web user run just that one command. We probe it with the
	 * helper's no-op "--check" so the button only lights up once it truly works.
	 *
	 * @return array{available: bool, helper: string, user: string, sudoers: string, container: bool}
	 */
	public function arpFlushInfo(): array {
		$user = (function_exists('posix_getpwuid') && function_exists('posix_geteuid'))
			? (posix_getpwuid(posix_geteuid())['name'] ?? 'www-data') : 'www-data';
		$available = false;
		if (is_file(self::ARP_FLUSH_HELPER)) {
			$r = $this->exec->run('sudo', ['-n', self::ARP_FLUSH_HELPER, '--check'], 5.0);
			$available = ((int)($r['code'] ?? 1)) === 0;
		}
		return [
			'available' => $available,
			'helper' => self::ARP_FLUSH_HELPER,
			'user' => $user,
			'sudoers' => '/etc/sudoers.d/netbase-arp',
			'container' => is_file('/.dockerenv') || is_file('/run/.containerenv'),
		];
	}

	/**
	 * Clear the neighbour (ARP) table via the installed helper.
	 *
	 * @return array{ok: bool, cleared: int}
	 */
	public function arpFlush(): array {
		if (!is_file(self::ARP_FLUSH_HELPER)) {
			throw new \RuntimeException('The ARP-clear helper is not installed on this server.');
		}
		$before = $this->neighbourCount();
		$r = $this->exec->run('sudo', ['-n', self::ARP_FLUSH_HELPER], 12.0);
		if (((int)($r['code'] ?? 1)) !== 0) {
			throw new \RuntimeException(trim((string)($r['stderr'] ?? '')) ?: 'The ARP table could not be cleared.');
		}
		return ['ok' => true, 'cleared' => max(0, $before - $this->neighbourCount())];
	}

	/**
	 * The kernel neighbour (ARP) table, keyed by IPv4 address.
	 *
	 * @return array<string, array{mac: string, interface: string, flags: int}>
	 */
	public function neighbours(?string $interface = null): array {
		// `ip neigh` carries the neighbour state, which /proc/net/arp does not:
		// there every completed entry is flags 0x2 whether the device is here now
		// (REACHABLE) or gone but not yet evicted (STALE with a dead MAC). Use it
		// when available so a powered-off device is not reported as present.
		$viaIp = $this->neighboursViaIp($interface);
		if ($viaIp !== null) {
			return $viaIp;
		}
		return $this->neighboursViaProc($interface);
	}

	/**
	 * @return array<string, array{mac: string, interface: string, flags: int, state: string, reachable: bool}>|null
	 *   null when `ip` is unavailable or the command fails.
	 */
	private function neighboursViaIp(?string $interface): ?array {
		if (!$this->exec->available('ip')) {
			return null;
		}
		$r = $this->exec->run('ip', ['-4', 'neigh', 'show'], 5.0);
		if (empty($r['ok'])) {
			return null;
		}
		$out = [];
		foreach (explode("\n", (string)$r['stdout']) as $line) {
			$line = trim($line);
			if ($line === '') {
				continue;
			}
			// "10.0.0.2 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE"
			$f = preg_split('/\s+/', $line);
			$ip = $f[0] ?? '';
			if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
				continue;
			}
			$dev = '';
			$mac = '';
			$state = '';
			$n = count($f);
			for ($i = 1; $i < $n; $i++) {
				if ($f[$i] === 'dev' && isset($f[$i + 1])) {
					$dev = $f[$i + 1];
					$i++;
				} elseif ($f[$i] === 'lladdr' && isset($f[$i + 1])) {
					$mac = strtolower($f[$i + 1]);
					$i++;
				} elseif (in_array($f[$i], self::NUD_STATES, true)) {
					$state = $f[$i];
				}
			}
			if ($mac === '' || $mac === '00:00:00:00:00:00') {
				continue; // INCOMPLETE / FAILED with no address to show
			}
			if ($interface !== null && $dev !== $interface) {
				continue;
			}
			$out[$ip] = [
				'mac' => $mac,
				'interface' => $dev,
				'flags' => 2,
				'state' => $state,
				'reachable' => in_array($state, self::REACHABLE_STATES, true),
			];
		}
		return $out;
	}

	/**
	 * Fallback for hosts without the `ip` command: /proc/net/arp cannot tell a
	 * present device from a stale entry, so a completed entry is treated as
	 * reachable — the previous behaviour, best effort.
	 *
	 * @return array<string, array{mac: string, interface: string, flags: int, state: string, reachable: bool}>
	 */
	private function neighboursViaProc(?string $interface): array {
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
			$out[$ip] = [
				'mac' => strtolower($mac),
				'interface' => $dev,
				'flags' => (int)hexdec(ltrim($flags, '0x') ?: '0'),
				'state' => '',
				'reachable' => true,
			];
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
	/**
	 * Listen to a multicast group without asking anything.
	 *
	 * Asking only finds what can answer. A device whose address belongs to
	 * another network — a camera still on its factory 192.168.1.120, plugged
	 * into a 10.0.0.0/16 wire — hears the question perfectly well but cannot
	 * reply: our address is off its own subnet, so its answer goes to a
	 * gateway that is not there. What it does do, unprompted, is announce
	 * itself to the group, and that is multicast at the level of the wire and
	 * arrives whatever the addresses say. So NetBase listens as well as asks.
	 *
	 * @return array<string, list<string>> what was heard, by sender
	 */
	public function multicastHear(string $sourceIp, string $group, int $port, float $wait, int $ifIndex = 0, string $ask = ''): array {
		if (!$this->hasSockets()) {
			return [];
		}
		$sock = @socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
		if ($sock === false) {
			return [];
		}
		@socket_set_option($sock, SOL_SOCKET, SO_REUSEADDR, 1);
		// The group's own port, because that is where an announcement is sent.
		if (!@socket_bind($sock, '0.0.0.0', $port)) {
			socket_close($sock);
			return [];
		}
		// MCAST_JOIN_GROUP is what PHP 8 offers; IP_ADD_MEMBERSHIP is not defined
		// in every build, and naming it where it is not defined is a fatal error
		// rather than a failed call — which is why the whole step stopped
		// without a word. The interface is named by index, and 0 means "let the
		// kernel choose", which is right when the wire is the only one.
		$joined = false;
		if (defined('MCAST_JOIN_GROUP')) {
			$joined = @socket_set_option($sock, IPPROTO_IP, MCAST_JOIN_GROUP, ['group' => $group, 'interface' => $ifIndex]);
		}
		if (!$joined && defined('IP_ADD_MEMBERSHIP')) {
			$joined = @socket_set_option($sock, IPPROTO_IP, constant('IP_ADD_MEMBERSHIP'), ['group' => $group, 'interface' => $sourceIp]);
		}
		if (!$joined) {
			socket_close($sock);
			return [];
		}
		socket_set_nonblock($sock);
		// Ask from the same socket that is listening to the group. A device on
		// another network cannot answer us directly — its reply would go to a
		// gateway it does not have — but plenty of them answer to the group,
		// and that arrives. Without the question the only thing to wait for is
		// the device's own timer, which on the camera here is half a minute.
		if ($ask !== '') {
			@socket_set_option($sock, IPPROTO_IP, IP_MULTICAST_TTL, 2);
			for ($i = 0; $i < 3; $i++) {
				@socket_sendto($sock, $ask, strlen($ask), 0, $group, $port);
				usleep(180000);
			}
		}

		$result = [];
		$deadline = microtime(true) + $wait;
		while (microtime(true) < $deadline) {
			$buf = '';
			$from = '';
			$fromPort = 0;
			if (@socket_recvfrom($sock, $buf, 8192, 0, $from, $fromPort) > 0) {
				if ($from !== $sourceIp) {
					$result[$from][] = $buf;
				}
			} else {
				usleep(4000);
			}
		}
		socket_close($sock);
		return $result;
	}

	/**
	 * The same, listening on every wire at once.
	 *
	 * One socket can join a group on several interfaces, and then the wait is
	 * paid once instead of once per wire. That matters here because the wait
	 * has to be longer than the announcement interval — three quarters of a
	 * minute on the camera measured here — and paying that twice would make a
	 * background job that runs for two minutes.
	 *
	 * @param list<array{index: int, ip: string}> $wires
	 * @return array<string, list<string>> what was heard, by sender
	 */
	public function multicastHearAll(array $wires, string $group, int $port, float $wait, string $ask = ''): array {
		if (!$this->hasSockets() || $wires === []) {
			return [];
		}
		$sock = @socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
		if ($sock === false) {
			return [];
		}
		@socket_set_option($sock, SOL_SOCKET, SO_REUSEADDR, 1);
		if (!@socket_bind($sock, '0.0.0.0', $port)) {
			socket_close($sock);
			return [];
		}
		$ours = [];
		$joined = 0;
		foreach ($wires as $wire) {
			$ours[$wire['ip']] = true;
			$ok = false;
			if (defined('MCAST_JOIN_GROUP')) {
				$ok = @socket_set_option($sock, IPPROTO_IP, MCAST_JOIN_GROUP, ['group' => $group, 'interface' => (int)$wire['index']]);
			}
			if (!$ok && defined('IP_ADD_MEMBERSHIP')) {
				$ok = @socket_set_option($sock, IPPROTO_IP, constant('IP_ADD_MEMBERSHIP'), ['group' => $group, 'interface' => $wire['ip']]);
			}
			$joined += $ok ? 1 : 0;
		}
		if ($joined === 0) {
			socket_close($sock);
			return [];
		}
		socket_set_nonblock($sock);
		if ($ask !== '') {
			@socket_set_option($sock, IPPROTO_IP, IP_MULTICAST_TTL, 2);
			foreach ($wires as $wire) {
				@socket_set_option($sock, IPPROTO_IP, IP_MULTICAST_IF, (int)$wire['index']);
				for ($i = 0; $i < 2; $i++) {
					@socket_sendto($sock, $ask, strlen($ask), 0, $group, $port);
					usleep(120000);
				}
			}
		}

		$result = [];
		$deadline = microtime(true) + $wait;
		while (microtime(true) < $deadline) {
			$buf = '';
			$from = '';
			$fromPort = 0;
			if (@socket_recvfrom($sock, $buf, 8192, 0, $from, $fromPort) > 0) {
				if (!isset($ours[$from])) {
					$result[$from][] = $buf;
				}
			} else {
				usleep(4000);
			}
		}
		socket_close($sock);
		return $result;
	}

	/**
	 * Listen to several announcement channels at once, on every wire.
	 *
	 * A device fresh out of its box announces itself in whichever dialect its
	 * maker chose — SSDP for a camera, WS-Discovery for a printer, mDNS for
	 * anything Apple has touched, LLMNR for Windows. Listening to one of them
	 * and calling that "the network" misses most of what gets plugged in, and
	 * listening to them one after another costs the announcement interval each
	 * time. So they are all watched together, and the wait is paid once.
	 *
	 * Only ports above 1024 appear here. NetBIOS (137) and DHCP (67) would
	 * both be worth hearing and both need a privileged port to bind, which
	 * this app will not ask for.
	 *
	 * @param list<array{index: int, ip: string}> $wires
	 * @param list<array{group: string, port: int, ask?: string}> $channels
	 * @return array<string, list<array{port: int, body: string}>> what was heard, by sender
	 */
	public function multicastHearMany(array $wires, array $channels, float $wait): array {
		if (!$this->hasSockets() || $wires === [] || $channels === []) {
			return [];
		}
		$ours = [];
		foreach ($wires as $wire) {
			$ours[$wire['ip']] = true;
		}

		$socks = [];
		$portOf = [];
		foreach ($channels as $channel) {
			$sock = @socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
			if ($sock === false) {
				continue;
			}
			@socket_set_option($sock, SOL_SOCKET, SO_REUSEADDR, 1);
			if (!@socket_bind($sock, '0.0.0.0', $channel['port'])) {
				socket_close($sock);
				continue;
			}
			$joined = 0;
			foreach ($wires as $wire) {
				$ok = false;
				if (defined('MCAST_JOIN_GROUP')) {
					$ok = @socket_set_option($sock, IPPROTO_IP, MCAST_JOIN_GROUP, ['group' => $channel['group'], 'interface' => (int)$wire['index']]);
				}
				if (!$ok && defined('IP_ADD_MEMBERSHIP')) {
					$ok = @socket_set_option($sock, IPPROTO_IP, constant('IP_ADD_MEMBERSHIP'), ['group' => $channel['group'], 'interface' => $wire['ip']]);
				}
				$joined += $ok ? 1 : 0;
			}
			if ($joined === 0) {
				socket_close($sock);
				continue;
			}
			socket_set_nonblock($sock);
			// Ask as well as listen. Anything that can answer answers at once,
			// and only what cannot is left to its own timer.
			if (($channel['ask'] ?? '') !== '') {
				@socket_set_option($sock, IPPROTO_IP, IP_MULTICAST_TTL, 2);
				foreach ($wires as $wire) {
					@socket_set_option($sock, IPPROTO_IP, IP_MULTICAST_IF, (int)$wire['index']);
					@socket_sendto($sock, $channel['ask'], strlen($channel['ask']), 0, $channel['group'], $channel['port']);
				}
			}
			$socks[] = $sock;
			$portOf[] = $channel['port'];
		}
		if ($socks === []) {
			return [];
		}

		$result = [];
		$deadline = microtime(true) + $wait;
		while (($left = $deadline - microtime(true)) > 0) {
			$read = $socks;
			$write = null;
			$except = null;
			$ready = @socket_select($read, $write, $except, (int)$left, (int)(fmod($left, 1) * 1000000));
			if ($ready === false || $ready === 0) {
				continue;
			}
			foreach ($read as $sock) {
				$buf = '';
				$from = '';
				$fromPort = 0;
				if (@socket_recvfrom($sock, $buf, 8192, 0, $from, $fromPort) > 0 && !isset($ours[$from])) {
					$at = array_search($sock, $socks, true);
					$result[$from][] = ['port' => $at === false ? 0 : $portOf[$at], 'body' => $buf];
				}
			}
		}
		foreach ($socks as $sock) {
			socket_close($sock);
		}
		return $result;
	}

	/** The four announcement channels an unprivileged process can listen to. */
	public function announcementChannels(): array {
		$uuid = sprintf('urn:uuid:%s', $this->uuid4());
		return [
			[
				'group' => '239.255.255.250',
				'port' => 1900,
				'ask' => "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n",
			],
			[
				'group' => '239.255.255.250',
				'port' => 3702,
				'ask' => '<?xml version="1.0" encoding="utf-8"?>'
					. '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"'
					. ' xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"'
					. ' xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery">'
					. '<soap:Header><wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>'
					. '<wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>'
					. '<wsa:MessageID>' . $uuid . '</wsa:MessageID></soap:Header>'
					. '<soap:Body><wsd:Probe/></soap:Body></soap:Envelope>',
			],
			['group' => '224.0.0.251', 'port' => 5353],
			['group' => '224.0.0.252', 'port' => 5355],
		];
	}

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

	/**
	 * Which of these addresses answer a TCP connection — the reliable, root-free
	 * "is it here now?" test. A host that is up answers a connection attempt
	 * whether the port is open (SYN-ACK) or closed (RST); only a host that is
	 * absent, off, or silently firewalling every port stays silent. This is what
	 * tells a device that is still here from one whose stale ARP entry lingers
	 * after it was switched off. A common spread of ports is tried so one of them
	 * lands.
	 *
	 * @param list<string> $ips
	 * @return list<string> the addresses that answered
	 */
	public function alive(array $ips, array $ports = [80, 443, 22, 445, 139, 8080, 631, 9100, 53, 23, 3389, 8443], float $timeout = 0.8, int $maxSockets = 512): array {
		$up = [];
		$pairs = [];
		foreach ($ips as $ip) {
			foreach ($ports as $port) {
				$pairs[] = [$ip, $port];
			}
		}
		foreach (array_chunk($pairs, $maxSockets) as $chunk) {
			$pending = [];
			foreach ($chunk as [$ip, $port]) {
				if (isset($up[$ip])) {
					continue; // already answered on an earlier port
				}
				$target = str_contains($ip, ':') ? '[' . $ip . ']' : $ip;
				$sock = @stream_socket_client(
					'tcp://' . $target . ':' . $port,
					$errno,
					$errstr,
					$timeout,
					STREAM_CLIENT_ASYNC_CONNECT | STREAM_CLIENT_CONNECT
				);
				if ($sock !== false) {
					$pending[] = ['sock' => $sock, 'ip' => $ip];
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
					$sock = $entry['sock'];
					if (!in_array($sock, $write, true) && !in_array($sock, $except, true)) {
						continue;
					}
					// Ready either way means the host answered — SYN-ACK (open) or
					// RST (closed). Both prove it is here. A timeout never lands here.
					$up[$entry['ip']] = true;
					@fclose($sock);
					unset($pending[$key]);
				}
				$pending = array_values($pending);
			}
			foreach ($pending as $entry) {
				@fclose($entry['sock']);
			}
		}
		return array_keys($up);
	}

	/**
	 * Keep only the addresses on one of this server's own subnets. A TCP probe
	 * to an off-link address would test the route, not the device, so presence
	 * there is judged by what the device announces, not by this.
	 *
	 * @param list<string> $ips
	 * @return list<string>
	 */
	public function onLinkOnly(array $ips): array {
		$nets = [];
		foreach ($this->interfaces() as $if) {
			if ($if['loopback'] || !$if['up']) {
				continue;
			}
			foreach ($if['addresses'] as $addr) {
				if (($addr['family'] ?? '') === 'inet' && isset($addr['network'], $addr['cidr'])) {
					$nets[] = [$addr['network'], (int)$addr['cidr']];
				}
			}
		}
		$out = [];
		foreach ($ips as $ip) {
			if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
				continue;
			}
			foreach ($nets as [$net, $cidr]) {
				if ($this->networkOf($ip, $cidr) === $net) {
					$out[] = $ip;
					break;
				}
			}
		}
		return array_values(array_unique($out));
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
