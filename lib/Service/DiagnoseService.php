<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\DeviceMapper;
use OCP\App\IAppManager;
use OCP\IConfig;

/**
 * The environment report: what this server runs in, which networks it sees,
 * what it may do, and the state of the device records — so a problem report
 * says at once whether a fault lies with the container or with NetBase.
 *
 * It does not scan and changes nothing in the records: the only packets are one
 * empty datagram to each address on file in this server's own networks, so the
 * kernel's ARP table holds them when it is read.
 * The one thing it keeps is the list of addresses it saw (address, MAC,
 * name), so a second run — after containers were restarted, say — can show
 * what changed between the two.
 */
class DiagnoseService {
	/** Where the addresses seen by the previous run are kept. */
	private const SNAPSHOT_KEY = 'diag_snapshot';
	/** Most addresses whose names are asked, and most lines in one list. */
	private const MAX_NAMES = 256;
	private const MAX_LINES = 60;

	public function __construct(
		private DiscoveryService $discovery,
		private DeviceMapper $devices,
		private OuiService $oui,
		private ExecService $exec,
		private IConfig $config,
		private IAppManager $apps,
	) {
	}

	/**
	 * @param bool $mask hide the last half of each MAC and public addresses
	 * @param bool $save keep this run's addresses for the next run to compare with
	 * @return array{text: string}
	 */
	public function report(bool $mask = true, bool $save = true): array {
		$started = microtime(true);
		$L = [];
		$hint = [];
		$m = fn (string $mac): string => $mask ? self::maskMac($mac) : $mac;
		$a = fn (string $ip): string => $mask ? self::maskIp($ip) : $ip;

		$L[] = '**NetBase environment report**';
		$L[] = '```';
		$L[] = 'made ' . gmdate('Y-m-d H:i') . ' UTC' . ($mask ? ' — MACs and public addresses partly hidden' : '');

		// ------------------------------------------------------------ versions
		$L[] = '';
		$L[] = '== versions';
		$L[] = 'NetBase ' . $this->apps->getAppVersion('netbase') . ', Nextcloud ' . $this->config->getSystemValueString('version', '?')
			. ', PHP ' . PHP_VERSION . ', ' . php_uname('s') . ' ' . php_uname('r') . ' ' . php_uname('m');
		$L[] = 'system: ' . self::osName((string)@file_get_contents('/etc/os-release'));
		$L[] = 'web server user: ' . self::processUser();

		// ------------------------------------------------------------ runs in
		$env = $this->environment();
		$ifs = $this->discovery->interfaces();
		$names = array_map(static fn ($i) => (string)$i['name'], $ifs);
		$hostNet = self::looksLikeHostNetwork($names);
		$L[] = '';
		$L[] = '== runs in';
		$L[] = 'kind: ' . $env['kind'];
		foreach ($env['signs'] as $sign) {
			$L[] = '  sign: ' . $sign;
		}
		if ($env['container']) {
			$L[] = 'network: ' . ($hostNet
				? 'the host\'s own (host networking: the host\'s interfaces are visible)'
				: 'a network of its own (only ' . implode(', ', array_diff($names, ['lo'])) . ' — the host\'s interfaces are not visible)');
		}

		// ------------------------------------------------------------ network
		$route = $this->discovery->defaultRoute();
		$L[] = '';
		$L[] = '== networks';
		foreach ($ifs as $i) {
			if ($i['loopback']) {
				continue;
			}
			$addrs = array_map(static fn ($x) => $x['ip'] . '/' . $x['cidr'],
				array_filter($i['addresses'], static fn ($x) => $x['family'] === 'inet'));
			$L[] = sprintf('%-12s %-5s MAC %s  %s', $i['name'], $i['up'] ? 'up' : 'down',
				$i['mac'] !== '' ? $m($i['mac']) . ($this->oui->describe($i['mac'])['local'] ? ' (random)' : '') : '-',
				$addrs === [] ? '(no IPv4)' : implode(' ', array_map($a, $addrs)));
		}
		$L[] = 'default route: ' . ($route['gateway'] !== '' ? $a($route['gateway']) . ' via ' . $route['interface'] : '(none)');
		$own = [];
		foreach ($ifs as $i) {
			foreach ($i['addresses'] as $x) {
				if (!$i['loopback'] && $x['family'] === 'inet') {
					$own[] = $x['network'] . '/' . $x['cidr'];
				}
			}
		}
		$containerNets = array_values(array_filter($own, [self::class, 'isContainerRange']));
		if ($containerNets !== []) {
			$L[] = 'container networks among them: ' . implode(', ', array_map($a, $containerNets))
				. ' (the ranges Docker and Podman hand out)';
		}
		$dns = self::nameservers((string)@file_get_contents('/etc/resolv.conf'));
		$L[] = 'name servers: ' . ($dns === [] ? '(none)' : implode(', ', array_map($a, $dns)));

		// ------------------------------------------------------------ may do
		$L[] = '';
		$L[] = '== what it may do';
		$caps = self::capabilities((string)@file_get_contents('/proc/self/status'));
		$tools = [];
		foreach (['ip', 'ping', 'arp-scan', 'nmap', 'iperf3', 'ssh', 'sudo'] as $bin) {
			$tools[] = $bin . ($this->exec->available($bin) ? ' yes' : ' no');
		}
		$L[] = 'programs: ' . implode(', ', $tools);
		$L[] = 'PHP: sockets ' . ($this->discovery->hasSockets() ? 'yes' : 'no') . ', proc_open ' . (function_exists('proc_open') ? 'yes' : 'no');
		$L[] = 'raw network access of this process: NET_RAW ' . ($caps['net_raw'] ? 'yes' : 'no') . ', NET_ADMIN ' . ($caps['net_admin'] ? 'yes' : 'no');
		if ($route['gateway'] !== '' && $this->exec->available('ping')) {
			$p = $this->exec->run('ping', ['-c', '1', '-W', '1', $route['gateway']], 4.0);
			$L[] = 'ping to the default route: ' . (((int)($p['code'] ?? 1)) === 0 ? 'answered' : 'no answer or not allowed');
		}
		$flush = $this->discovery->arpFlushInfo();
		$L[] = 'ARP-clear helper: ' . ($flush['available'] ? 'installed and working' : 'not installed');

		// ------------------------------------------------------------ ARP table now
		// The kernel keeps only the neighbours it spoke to lately, so the addresses
		// already on file in this server's own networks get one empty datagram each
		// (as a scan's first step does) and the table is read after that.
		$onFile = [];
		foreach ($this->devices->findAll() as $d) {
			$ip = (string)$d->getIp();
			if ($ip !== '' && self::inAny($ip, $own)) {
				$onFile[] = $ip;
			}
		}
		$onFile = array_slice(array_values(array_unique($onFile)), 0, 1024);
		if ($onFile !== []) {
			$this->discovery->primeNeighbours($onFile);
			usleep(800000);
		}
		$neigh = $this->discovery->neighbours();
		$complete = array_filter($neigh, static fn ($n) => ($n['mac'] ?? '') !== '' && $n['mac'] !== '00:00:00:00:00:00');
		$random = 0;
		foreach ($complete as $n) {
			if ($this->oui->describe((string)$n['mac'])['local']) {
				$random++;
			}
		}
		$t = microtime(true);
		$rdns = $this->namesOf(array_slice(array_keys($complete), 0, self::MAX_NAMES));
		$rdnsMs = (int)round((microtime(true) - $t) * 1000);
		$L[] = '';
		$L[] = '== the ARP table now';
		$withState = $neigh !== [] && isset(reset($neigh)['state']);
		$L[] = 'read from: ' . ($withState ? 'ip neigh (with the kernel\'s states)'
			: '/proc/net/arp (no states: an address that changed hands in the last minute or so may still show its old MAC)');
		$L[] = sprintf('addresses on file in this server\'s own networks, touched once to fill the table: %d', count($onFile));
		$L[] = sprintf('%d entries, %d with a MAC; of those %d random (locally administered) MACs; names found for %d (%d ms)',
			count($neigh), count($complete), $random, count($rdns), $rdnsMs);

		// ------------------------------------------------------------ changes since last run
		$now = [];
		foreach ($complete as $ip => $n) {
			$now[(string)$ip] = ['mac' => strtolower((string)$n['mac']), 'name' => (string)($rdns[$ip] ?? '')];
		}
		$prev = json_decode($this->config->getAppValue('netbase', self::SNAPSHOT_KEY, ''), true);
		$L[] = '';
		$L[] = '== changes since the previous report';
		$changes = null;
		if (!is_array($prev) || !isset($prev['rows'])) {
			$L[] = '(no previous report on this server; run it again after the change — a container restart, say — to see what moved)';
		} else {
			$changes = self::compare((array)$prev['rows'], $now);
			$L[] = 'previous report: ' . gmdate('Y-m-d H:i', (int)($prev['at'] ?? 0)) . ' UTC';
			$L[] = sprintf('same address, same name, new MAC: %d', count($changes['newMac']));
			foreach (array_slice($changes['newMac'], 0, self::MAX_LINES) as $c) {
				$L[] = sprintf('  %-15s %s  %s -> %s', $a($c['ip']), $c['name'], $m($c['was']), $m($c['now']));
			}
			$L[] = sprintf('address now held by another name: %d', count($changes['otherName']));
			foreach (array_slice($changes['otherName'], 0, self::MAX_LINES) as $c) {
				$L[] = sprintf('  %-15s %s -> %s', $a($c['ip']), $c['was'], $c['now']);
			}
			$L[] = sprintf('name moved to another address: %d', count($changes['moved']));
			foreach (array_slice($changes['moved'], 0, self::MAX_LINES) as $c) {
				$L[] = sprintf('  %-24s %s -> %s', $c['name'], $a($c['was']), $a($c['now']));
			}
		}

		// ------------------------------------------------------------ records
		$rows = $this->devices->findAll();
		$total = count($rows);
		$online = $picked = $containers = $randomRows = $noMac = 0;
		$byIp = [];
		foreach ($rows as $d) {
			if ($d->getOnline()) { $online++; }
			if (ScanService::typeChosen($d)) { $picked++; }
			if (in_array(strtolower((string)$d->getDtype()), ['container', 'コンテナ'], true)) { $containers++; }
			$mac = (string)$d->getMac();
			if ($mac === '') { $noMac++; } elseif ($this->oui->describe($mac)['local']) { $randomRows++; }
			if (($d->getIp() ?? '') !== '') { $byIp[(string)$d->getIp()] = $d; }
		}
		$parked = $this->devices->findParked();
		$dupes = $this->devices->duplicateIps();
		$L[] = '';
		$L[] = '== NetBase\'s device records';
		$L[] = sprintf('%d rows, %d online; %d with a type picked by hand (%d of them "container"); %d with a random MAC; %d without a MAC',
			$total, $online, $picked, $containers, $randomRows, $noMac);
		$L[] = sprintf('set aside until their name turns up again: %d%s', count($parked),
			$parked === [] ? '' : ' (' . implode(', ', array_slice(array_map(static fn ($d) => (string)$d->getHostname(), $parked), 0, 20)) . ')');
		$L[] = sprintf('addresses on more than one row: %d%s', count($dupes),
			$dupes === [] ? '' : ' (' . implode(', ', array_map($a, array_slice($dupes, 0, 20))) . ')');
		$differ = [];
		foreach ($now as $ip => $n) {
			$d = $byIp[$ip] ?? null;
			if ($d === null) {
				continue;
			}
			$rowMac = strtolower((string)$d->getMac());
			if ($rowMac !== '' && $rowMac !== $n['mac']) {
				$differ[] = sprintf('  %-15s record %s %s, now %s %s', $a($ip), $m($rowMac), (string)$d->getHostname() ?: '-', $m($n['mac']), $n['name'] ?: '-');
			}
		}
		$L[] = sprintf('addresses whose MAC in the ARP table differs from the record (the next scan settles them): %d', count($differ));
		foreach (array_slice($differ, 0, self::MAX_LINES) as $line) {
			$L[] = $line;
		}

		// ------------------------------------------------------------ reading
		$L[] = '';
		$L[] = '== reading';
		if ($env['container'] && !$hostNet) {
			$hint[] = 'NetBase runs in a container on a network of its own. It sees that network (' . implode(', ', array_map($a, $own)) . ') with MACs and names; '
				. 'devices of the LAN beyond it are reached by TCP only — without MACs, vendors or the ARP table. That is how the container is set up, not a fault of NetBase.';
		}
		if ($containerNets !== [] && count($complete) > 0 && $random * 2 >= count($complete)) {
			$hint[] = 'Most addresses seen here have random MACs, as containers do. Docker and Podman give a container a new MAC on every start and may hand its address to another; '
				. 'to keep them, fix them per container (in compose: ipv4_address and mac_address). That is the container\'s behaviour, not a fault of NetBase.';
		}
		if ($changes !== null && ($changes['otherName'] !== [] || $changes['moved'] !== [])) {
			$hint[] = 'Since the previous report, addresses changed hands between devices (see above). NetBase follows a device by its name when it can; '
				. 'if something a person wrote (a type picked by hand, a note) did not follow its device, that is a NetBase fault — please report it with this output and the scan diagnosis.';
		}
		if ($dupes !== []) {
			$hint[] = 'An address is on more than one row. That should not stay after a scan: a NetBase fault if it does.';
		}
		if ($hint === []) {
			$hint[] = 'Nothing here points to the environment. If something is wrong, please report it with this output and the scan diagnosis.';
		}
		foreach ($hint as $h) {
			$L[] = '- ' . $h;
		}
		$L[] = sprintf('(made in %.1f s)', microtime(true) - $started);
		$L[] = '```';

		if ($save) {
			$this->config->setAppValue('netbase', self::SNAPSHOT_KEY, (string)json_encode(['at' => time(), 'rows' => $now], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
		}
		return ['text' => implode("\n", $L)];
	}

	/** Reverse-DNS names, giving up when the resolver is too slow to finish in reasonable time. */
	private function namesOf(array $ips): array {
		$out = [];
		$deadline = microtime(true) + 15.0;
		foreach ($ips as $ip) {
			if (microtime(true) > $deadline) {
				break;
			}
			$name = @gethostbyaddr((string)$ip);
			if (is_string($name) && $name !== '' && $name !== $ip) {
				$out[(string)$ip] = $name;
			}
		}
		return $out;
	}

	/** @return array{kind: string, container: bool, signs: list<string>} */
	private function environment(): array {
		$signs = [];
		$kind = 'native (no sign of a container)';
		$container = false;
		$cgroup = (string)@file_get_contents('/proc/1/cgroup');
		$containerenv = (string)@file_get_contents('/run/.containerenv');
		$found = self::containerKind(is_file('/.dockerenv'), is_file('/run/.containerenv'), $containerenv, $cgroup);
		if ($found !== '') {
			$kind = $found;
			$container = true;
		}
		if (is_file('/.dockerenv')) { $signs[] = '/.dockerenv exists'; }
		if (is_file('/run/.containerenv')) { $signs[] = '/run/.containerenv exists'; }
		foreach (['docker', 'libpod', 'kubepods', 'lxc', 'containerd'] as $word) {
			if (str_contains($cgroup, $word)) { $signs[] = 'cgroup of process 1 mentions ' . $word; }
		}
		$init = trim((string)@file_get_contents('/proc/1/comm'));
		if ($init !== '') { $signs[] = 'process 1 is ' . $init; }
		if (is_file('/entrypoint.sh') && is_dir('/usr/src/nextcloud')) {
			$signs[] = '/entrypoint.sh and /usr/src/nextcloud exist (as in the official Nextcloud image)';
		}
		$aio = array_values(array_filter(array_keys(getenv() ?: []), static fn ($k) => str_contains(strtoupper((string)$k), 'AIO')));
		$host = (string)gethostname();
		if ($aio !== [] || str_contains(strtolower($host), 'aio')) {
			$signs[] = 'Nextcloud AIO likely' . ($aio !== [] ? ' (environment names: ' . implode(', ', array_slice($aio, 0, 5)) . ')' : ' (host name ' . $host . ')');
		}
		if (getenv('SNAP') || str_starts_with((string)\OC::$SERVERROOT, '/snap/')) {
			$kind = 'snap package';
			$signs[] = 'SNAP is set or Nextcloud lives under /snap';
		}
		$virt = $this->exec->available('systemd-detect-virt') ? trim((string)($this->exec->run('systemd-detect-virt', [], 3.0)['stdout'] ?? '')) : '';
		if ($virt !== '') { $signs[] = 'systemd-detect-virt: ' . $virt; }
		return ['kind' => $kind, 'container' => $container, 'signs' => $signs];
	}

	// ---------------------------------------------------------------- pure helpers (tested)

	public static function containerKind(bool $dockerenv, bool $containerenvFile, string $containerenv, string $cgroup): string {
		if ($containerenvFile) {
			// Podman writes this file (empty unless the container is privileged); Docker does not.
			$other = str_contains($containerenv, 'engine=') && !preg_match('/engine="?podman/i', $containerenv);
			return $other ? 'container (/run/.containerenv)' : 'Podman container';
		}
		if ($dockerenv) {
			return 'Docker container';
		}
		foreach (['kubepods' => 'Kubernetes container', 'libpod' => 'Podman container', 'docker' => 'Docker container', 'lxc' => 'LXC container'] as $word => $kind) {
			// /docker/<id> (cgroup v1) or docker-<id>.scope (systemd); not docker.service, the daemon itself.
			if (preg_match('#/' . $word . '(/|-[0-9a-f]{12,})#', $cgroup)) {
				return $kind;
			}
		}
		return '';
	}

	/** The host's interfaces are visible: a host-network container (or no container). */
	public static function looksLikeHostNetwork(array $names): bool {
		foreach ($names as $n) {
			if (preg_match('/^(docker\d|br-|veth|virbr|podman\d|cni|en[opsx]|wl|wlan|bond|vmbr)/', (string)$n)) {
				return true;
			}
		}
		return false;
	}

	/** 172.16.0.0/12 and 10.88.0.0/16: what Docker and Podman hand out by default. */
	public static function isContainerRange(string $cidr): bool {
		$ip = explode('/', $cidr)[0];
		$long = ip2long($ip);
		if ($long === false) {
			return false;
		}
		return ($long & 0xFFF00000) === (ip2long('172.16.0.0') & 0xFFF00000)
			|| ($long & 0xFFFF0000) === (ip2long('10.88.0.0') & 0xFFFF0000);
	}

	/** Whether an address lies in one of the given networks (a.b.c.d/n). */
	public static function inAny(string $ip, array $cidrs): bool {
		$long = ip2long($ip);
		if ($long === false) {
			return false;
		}
		foreach ($cidrs as $cidr) {
			[$net, $bits] = array_pad(explode('/', (string)$cidr, 2), 2, '32');
			$bits = (int)$bits;
			$mask = $bits <= 0 ? 0 : (~0 << (32 - $bits)) & 0xFFFFFFFF;
			$n = ip2long($net);
			if ($n !== false && ($long & $mask) === ($n & $mask)) {
				return true;
			}
		}
		return false;
	}

	/** aa:bb:cc:**:**:** — the vendor part and the random-MAC bit stay readable. */
	public static function maskMac(string $mac): string {
		$p = explode(':', strtolower($mac));
		return count($p) === 6 ? implode(':', array_slice($p, 0, 3)) . ':**:**:**' : $mac;
	}

	/** A public address loses its last two numbers; private, container and link-local ones stay. */
	public static function maskIp(string $ip): string {
		[$addr, $suffix] = array_pad(explode('/', $ip, 2), 2, null);
		if (!filter_var($addr, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)
			|| !filter_var($addr, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
			return $ip;
		}
		$o = explode('.', $addr);
		return $o[0] . '.' . $o[1] . '.x.x' . ($suffix !== null ? '/' . $suffix : '');
	}

	/** NET_RAW (bit 13) and NET_ADMIN (bit 12) of the effective capabilities. */
	public static function capabilities(string $status): array {
		$eff = preg_match('/^CapEff:\s*([0-9a-f]+)/mi', $status, $mm) ? $mm[1] : '0';
		$low = hexdec(substr(str_pad($eff, 16, '0', STR_PAD_LEFT), -8));
		return ['net_admin' => (bool)($low & (1 << 12)), 'net_raw' => (bool)($low & (1 << 13))];
	}

	public static function nameservers(string $resolv): array {
		preg_match_all('/^\s*nameserver\s+(\S+)/m', $resolv, $mm);
		return $mm[1];
	}

	public static function osName(string $osRelease): string {
		return preg_match('/^PRETTY_NAME="?([^"\n]+)"?/m', $osRelease, $mm) ? $mm[1] : '(unknown)';
	}

	private static function processUser(): string {
		if (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
			return (string)(posix_getpwuid(posix_geteuid())['name'] ?? posix_geteuid());
		}
		return '?';
	}

	/**
	 * What changed between two lists of address => {mac, name}.
	 *
	 * @return array{newMac: list<array>, otherName: list<array>, moved: list<array>}
	 */
	public static function compare(array $before, array $now): array {
		$out = ['newMac' => [], 'otherName' => [], 'moved' => []];
		foreach ($now as $ip => $n) {
			$b = $before[$ip] ?? null;
			if (!is_array($b)) {
				continue;
			}
			$wasName = ScanService::nameKey((string)($b['name'] ?? ''), (string)$ip);
			$nowName = ScanService::nameKey((string)$n['name'], (string)$ip);
			if ($wasName !== '' && $nowName !== '' && $wasName !== $nowName) {
				$out['otherName'][] = ['ip' => (string)$ip, 'was' => (string)$b['name'], 'now' => (string)$n['name']];
			} elseif ((string)($b['mac'] ?? '') !== '' && $b['mac'] !== $n['mac']) {
				$out['newMac'][] = ['ip' => (string)$ip, 'name' => (string)$n['name'] ?: (string)($b['name'] ?? '') ?: '-', 'was' => (string)$b['mac'], 'now' => (string)$n['mac']];
			}
		}
		$whereBefore = [];
		foreach ($before as $ip => $b) {
			$k = ScanService::nameKey((string)($b['name'] ?? ''), (string)$ip);
			if ($k !== '') {
				$whereBefore[$k] = (string)$ip;
			}
		}
		foreach ($now as $ip => $n) {
			$k = ScanService::nameKey((string)$n['name'], (string)$ip);
			if ($k !== '' && isset($whereBefore[$k]) && $whereBefore[$k] !== (string)$ip) {
				$out['moved'][] = ['name' => (string)$n['name'], 'was' => $whereBefore[$k], 'now' => (string)$ip];
			}
		}
		return $out;
	}
}
