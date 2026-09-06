<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\DeviceEntity;
use OCA\NetBase\Db\DeviceMapper;
use OCA\NetBase\Db\ScanEntity;
use OCA\NetBase\Db\ScanMapper;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * Runs a sweep in slices.
 *
 * A /16 is 65,534 addresses, which no single web request should try to finish.
 * The scan therefore keeps its position in the database and the browser asks
 * for the next slice, so progress is visible and nothing runs long enough to
 * hit a PHP or proxy timeout.
 */
class ScanService {
	public const PHASES = ['arp', 'sweep', 'names', 'mcast', 'ports', 'rdns', 'done'];

	/**
	 * How many connections one request's worth of port checking is allowed.
	 *
	 * A device that answers nothing at all costs the full timeout for every
	 * 512 sockets, so this is what decides how long a step can run: four
	 * thousand attempts is about seven seconds against the most silent device
	 * on the network, and worth a round trip against the most talkative.
	 */
	public const PORT_BUDGET = 4096;

	/**
	 * The waits offered for a port to answer, in seconds.
	 *
	 * A closed port that refuses is instant whatever this is set to; the wait
	 * only ever applies to a port that says nothing at all, which is what a
	 * firewall and a sleeping device both look like. Shorter is quicker and
	 * misses more.
	 */
	public const PORT_WAITS = [0.3, 0.9, 2.0];

	public function __construct(
		private DiscoveryService $discovery,
		private OuiService $oui,
		private DeviceMapper $devices,
		private ScanMapper $scans,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @param list<string> $targets CIDR blocks or single addresses
	 */
	public function start(?string $userId, array $targets, array $options = []): ScanEntity {
		$targets = array_values(array_filter(array_map('trim', $targets)));
		if ($targets === []) {
			foreach ($this->discovery->suggestedTargets() as $suggestion) {
				$targets[] = $suggestion['cidr'];
			}
		}

		$plan = [];
		$total = 0;
		foreach ($targets as $target) {
			$size = $this->planSize($target);
			if ($size === 0) {
				continue;
			}
			$plan[] = ['target' => $target, 'size' => $size];
			$total += $size;
		}
		if ($plan === []) {
			throw new \InvalidArgumentException('No valid scan target');
		}

		$maxHosts = (int)$this->config->getAppValue('netbase', 'max_hosts', '65536');
		if ($total > $maxHosts) {
			throw new \InvalidArgumentException('Scan target exceeds the configured limit of ' . $maxHosts . ' addresses');
		}

		$normalised = $this->normaliseOptions($options);
		$scan = new ScanEntity();
		$scan->setUserId($userId);
		$scan->setTargets(json_encode($targets));
		$scan->setOptions(json_encode($normalised));
		$scan->setPhase($normalised['arpOnly'] ? 'arp' : 'sweep');
		$scan->setState('running');
		$scan->setCursor(0);
		$scan->setTotal($total);
		$scan->setFound(0);
		$scan->setQueue(json_encode([
			'plan' => $plan, 'ips' => [], 'idx' => 0,
			'asked' => [], 'named' => [], 'retried' => [], 'retrying' => false,
			'mcastDone' => false, 'retryDone' => false,
		]));
		$scan->setStarted(time());
		$scan->setUpdated(time());

		$this->devices->markAllOffline();
		return $this->scans->insert($scan);
	}

	/**
	 * Advance one scan by roughly $budget seconds of work.
	 *
	 * @return array{scan: array, devices: list<array>}
	 */
	public function step(int $scanId, float $budget = 2.5): array {
		$scan = $this->scans->find($scanId);
		if ($scan === null) {
			throw new \RuntimeException('Scan not found');
		}
		if ($scan->getState() !== 'running') {
			return ['scan' => $scan->jsonSerialize(), 'devices' => $this->devicesJson()];
		}

		$queue = json_decode((string)$scan->getQueue(), true) ?: ['plan' => [], 'ips' => [], 'idx' => 0];
		$options = json_decode((string)$scan->getOptions(), true) ?: $this->normaliseOptions([]);
		$deadline = microtime(true) + $budget;

		try {
			while (microtime(true) < $deadline && $scan->getPhase() !== 'done') {
				match ($scan->getPhase()) {
					'arp' => $this->stepArp($scan, $queue, $options),
					'sweep' => $this->stepSweep($scan, $queue, $options),
					'names' => $this->stepNames($scan, $queue, $options),
					'mcast' => $this->stepMulticast($scan, $queue, $options),
					'ports' => $this->stepPorts($scan, $queue, $options),
					'rdns' => $this->stepRdns($scan, $queue, $options),
					default => $scan->setPhase('done'),
				};
			}
		} catch (\Throwable $e) {
			$this->logger->error('NetBase scan failed: ' . $e->getMessage(), ['exception' => $e, 'app' => 'netbase']);
			$scan->setState('error');
			$scan->setMessage($e->getMessage());
		}

		if ($scan->getPhase() === 'done' && $scan->getState() === 'running') {
			$scan->setState('done');
			$scan->setFinished(time());
			$scan->setCursor($scan->getTotal());
		}
		$scan->setQueue(json_encode($queue));
		$scan->setUpdated(time());
		$scan->setFound(count($queue['ips'] ?? []));
		$this->scans->update($scan);

		return ['scan' => $scan->jsonSerialize(), 'devices' => $this->devicesJson()];
	}

	public function cancel(int $scanId): void {
		$scan = $this->scans->find($scanId);
		if ($scan === null) {
			return;
		}
		$scan->setState('cancelled');
		$scan->setFinished(time());
		$this->scans->update($scan);
	}

	// ---------------------------------------------------------------- phases

	/**
	 * The ARP table, read, and nothing else.
	 *
	 * What the option says on the screen. No address is probed, nothing is
	 * asked of any device, no port is opened and no name is looked up: the
	 * kernel's table is read and the scan is over. It lists what this server
	 * has already spoken to and no more, which is the whole point of it.
	 */
	private function stepArp(ScanEntity $scan, array &$queue, array $options): void {
		$this->absorbNeighbours($queue, $options);
		$total = max(1, count($queue['ips'] ?? []));
		$scan->setCursor($scan->getTotal());
		$this->progress($scan, 'arp', $total, $total);
		// Skipping the sweep is skipping the walk through every address. What
		// follows is the part worth having — the names, the ports, the reverse
		// lookups — and it runs on whatever the table and the multicast turned
		// up, exactly as it would after a sweep.
		$scan->setPhase($options['names'] ? 'names' : ($options['ports'] ? 'ports' : 'rdns'));
	}

	private function stepSweep(ScanEntity $scan, array &$queue, array $options): void {
		$chunk = (int)$options['chunk'];
		$cursor = (int)$scan->getCursor();
		$total = (int)$scan->getTotal();

		// Read first: a device that woke up slowly — Wi-Fi power save easily
		// adds a few hundred milliseconds — will have answered the previous
		// slice by now, and this read costs nothing.
		$this->absorbNeighbours($queue, $options);

		$ips = $this->addressSlice($queue['plan'], $cursor, $chunk);
		if ($ips !== []) {
			$this->discovery->primeNeighbours($ips, (int)$options['rate']);
			usleep((int)($options['settle'] * 1000));
		}
		$this->absorbNeighbours($queue, $options);

		$cursor = min($total, $cursor + $chunk);
		$scan->setCursor($cursor);
		$this->progress($scan, 'sweep', $cursor, $total);
		if ($cursor >= $total) {
			// One more read: replies that arrived late still land in the table.
			usleep(200000);
			$this->absorbNeighbours($queue, $options);
			$queue['idx'] = 0;
			$scan->setPhase($options['names'] ? 'names' : ($options['ports'] ? 'ports' : 'rdns'));
		}
	}

	private function stepNames(ScanEntity $scan, array &$queue, array $options): void {
		$asked = $queue['asked'] ?? [];      // sent a first query to
		$named = $queue['named'] ?? [];      // answered with a usable name
		$retried = $queue['retried'] ?? [];  // sent the slower second query to
		$retrying = !empty($queue['retrying']);

		if (!$retrying && ($queue['ips'] ?? []) === []) {
			$this->absorbNeighbours($queue, $options);
		}
		$pending = $retrying
			? array_values(array_diff($asked, $named, $retried))
			: array_values(array_diff($queue['ips'] ?? [], $asked));
		$batch = array_slice($pending, 0, 128);

		if ($batch === []) {
			$queue['idx'] = 0;
			if ($retrying) {
				// The second round only ever runs at the very end of a scan.
				$queue['retrying'] = false;
				$scan->setPhase('done');
				return;
			}
			// Multicast discovery turns up addresses the sweep never saw, so it
			// runs before names are considered complete, and this phase is
			// entered once more afterwards for whatever it added.
			if ($options['multicast'] && empty($queue['mcastDone'])) {
				$scan->setPhase('mcast');
				return;
			}
			$scan->setPhase($options['ports'] ? 'ports' : 'rdns');
			return;
		}

		$wait = $retrying ? 2.0 : 1.2;
		$netbios = $this->discovery->netbios($batch, $wait);
		$mdns = $this->discovery->mdns($batch, $wait);

		foreach ($batch as $ip) {
			$update = [];
			if (isset($netbios[$ip])) {
				$update['hostname'] = $netbios[$ip]['host'] !== '' ? $netbios[$ip]['host'] : null;
				$update['workgroup'] = $netbios[$ip]['workgroup'] !== '' ? $netbios[$ip]['workgroup'] : null;
				$update['mac'] = $netbios[$ip]['mac'] !== '' ? $netbios[$ip]['mac'] : null;
				$update['source'] = 'netbios';
			}
			if (isset($mdns[$ip])) {
				$name = preg_replace('/\.local$/i', '', $mdns[$ip]) ?? $mdns[$ip];
				if (empty($update['hostname'])) {
					$update['hostname'] = $name;
				}
				$update['mdns'] = $mdns[$ip];
				$update['source'] = isset($update['source']) ? $update['source'] . ',mdns' : 'mdns';
			}
			if ($update !== []) {
				$this->upsert($ip, null, $update);
				$queue['named'][] = $ip;
			}
			if ($retrying) {
				$queue['retried'][] = $ip;
			} else {
				$queue['asked'][] = $ip;
			}
		}

		$total = count($queue['ips'] ?? []);
		$this->progress($scan, $retrying ? 'names2' : 'names', min(count($queue['asked'] ?? []), $total), $total);
	}

	private function stepMulticast(ScanEntity $scan, array &$queue, array $options): void {
		foreach ($this->discovery->interfaces() as $if) {
			if ($if['loopback'] || !$if['up'] || $if['addresses'] === []) {
				continue;
			}
			$source = '';
			foreach ($if['addresses'] as $addr) {
				if ($addr['family'] === 'inet') {
					$source = $addr['ip'];
					break;
				}
			}
			if ($source === '') {
				continue;
			}
			foreach ($this->discovery->wsDiscovery((int)$if['index'], $source, 1.2) as $ip => $info) {
				$this->upsert($ip, null, [
					'source' => 'wsd',
					'wsd' => $info['types'],
				]);
			}
			foreach ($this->discovery->ssdp((int)$if['index'], $source, 1.2) as $ip => $info) {
				$this->upsert($ip, null, [
					'source' => 'ssdp',
					'ssdp' => trim($info['server'] . ' ' . $info['location']),
				]);
			}
		}
		$this->absorbNeighbours($queue, $options);
		$queue['idx'] = 0;
		$queue['mcastDone'] = true;
		$queue['retrying'] = false;
		$this->progress($scan, 'mcast', 0, 0);
		$unnamed = array_diff($queue['ips'] ?? [], $queue['asked'] ?? []);
		if ($options['names'] && $unnamed !== []) {
			$scan->setPhase('names');
			return;
		}
		$scan->setPhase($options['ports'] ? 'ports' : 'rdns');
	}

	private function stepPorts(ScanEntity $scan, array &$queue, array $options): void {
		$ips = $queue['ips'] ?? [];
		$idx = (int)($queue['idx'] ?? 0);
		$ports = $this->portsFor($options);
		$count = count($ports);

		// The work is hosts times ports. With a short list that means many
		// hosts at once; with the whole range it means one host, walked across
		// as many requests as it takes, so no single step overruns.
		// The wait is what a step costs: every 512 sockets that answer nothing
		// take the full wait, so a longer wait has to mean fewer attempts per
		// request if the step is to finish in the same few seconds.
		$budget = max(512, (int)round(self::PORT_BUDGET * (0.9 / max(0.1, $wait))));
		$window = min($count, $budget);
		$hosts = max(1, min(24, intdiv($budget, max(1, $window))));
		$batch = array_slice($ips, $idx, $hosts);
		if ($batch === [] || $count === 0) {
			$queue['idx'] = 0;
			$queue['portAt'] = 0;
			$queue['open'] = [];
			$scan->setPhase($options['rdns'] ? 'rdns' : 'done');
			return;
		}

		$at = (int)($queue['portAt'] ?? 0);
		$slice = array_slice($ports, $at, $window);
		$wait = (float)$options['portWait'];
		$open = $this->discovery->tcpSweep($batch, $slice, $wait);
		$at += count($slice);
		$finished = $at >= $count;

		foreach ($batch as $ip) {
			$found = array_values(array_unique(array_merge($queue['open'][$ip] ?? [], $open[$ip] ?? [])));
			sort($found);
			$queue['open'][$ip] = $found;
			if (!$finished) {
				continue;
			}
			if ($found === [] && $count <= count(DiscoveryService::DETAILED_PORTS)) {
				// Nothing answered within the timeout. On the short lists it is
				// worth one slower second ask before recording a device as
				// having no services; after sixty-five thousand attempts it is
				// not.
				$retry = $this->discovery->tcpSweep([$ip], $ports, $wait * 1.8);
				$found = $retry[$ip] ?? [];
			}
			$this->upsert($ip, null, ['ports' => $found]);
			unset($queue['open'][$ip]);
		}

		if ($finished) {
			$queue['idx'] = $idx + count($batch);
			$queue['portAt'] = 0;
			$at = 0;
			$idx = (int)$queue['idx'];
		} else {
			$queue['portAt'] = $at;
		}
		// A list short enough to finish a device per step counts devices. A
		// range that takes minutes per device counts ports, because a count of
		// devices would not move at all while it ran.
		if ($window >= $count) {
			$this->progress($scan, 'ports', min($idx, count($ips)), count($ips));
		} else {
			$this->progress($scan, 'portsAll', $idx * $count + $at, count($ips) * $count);
		}
	}

	/**
	 * The ports a scan actually tries.
	 *
	 * The whole range is built here rather than stored: sixty-five thousand
	 * numbers do not belong in the scan's saved options.
	 *
	 * @return list<int>
	 */
	private function portsFor(array $options): array {
		$explicit = $options['portList'] ?? [];
		if (is_array($explicit) && $explicit !== []) {
			return array_values($explicit);
		}
		return match ($options['portScan'] ?? 'common') {
			'all' => range(1, 65535),
			// Everything IANA calls well known — where a service that expects to
			// be found still puts itself.
			'wellKnown' => range(1, 1024),
			'detailed' => DiscoveryService::DETAILED_PORTS,
			default => DiscoveryService::FINGERPRINT_PORTS,
		};
	}

	private function stepRdns(ScanEntity $scan, array &$queue, array $options): void {
		$ips = $queue['ips'] ?? [];
		$idx = (int)($queue['idx'] ?? 0);
		$batch = $options['rdns'] ? array_slice($ips, $idx, 16) : [];
		if ($batch === []) {
			// Devices that stayed silent earlier get one last, slower ask now
			// that the sweep is over and the network is quiet again — print
			// servers in particular tend to answer only once the flood stops.
			$silent = array_diff($queue['asked'] ?? [], $queue['named'] ?? [], $queue['retried'] ?? []);
			if ($options['names'] && empty($queue['retryDone']) && $silent !== []) {
				$queue['retryDone'] = true;
				$queue['retrying'] = true;
				$queue['idx'] = 0;
				$scan->setPhase('names');
				return;
			}
			$scan->setPhase('done');
			return;
		}
		foreach ($this->discovery->reverseDns($batch) as $ip => $name) {
			if (in_array(strtolower($name), ['_gateway', 'localhost', 'localhost.localdomain'], true)) {
				continue;
			}
			$this->upsert($ip, null, ['rdns' => $name, 'source' => 'rdns']);
		}
		$queue['idx'] = $idx + count($batch);
		$this->progress($scan, 'rdns', min((int)$queue['idx'], count($ips)), count($ips));
	}

	/** Record progress in a form the browser can translate. */
	private function progress(ScanEntity $scan, string $key, int $done, int $total): void {
		$scan->setMessage((string)json_encode(['key' => $key, 'done' => $done, 'total' => $total]));
	}

	// ---------------------------------------------------------------- persistence

	/** Read the neighbour table and record everything new in it. */
	private function absorbNeighbours(array &$queue, array $options): void {
		$known = array_flip($queue['ips'] ?? []);
		foreach ($this->discovery->neighbours() as $ip => $entry) {
			if (($options['interface'] ?? '') !== '' && $entry['interface'] !== $options['interface']) {
				continue;
			}
			$this->upsert($ip, $entry['mac'], [
				'interface' => $entry['interface'],
				'source' => 'arp',
			]);
			if (!isset($known[$ip])) {
				$queue['ips'][] = $ip;
				$known[$ip] = true;
			}
		}
	}

	/**
	 * Create or refresh one device row. Only fields we actually learned are
	 * touched, so a later phase never erases what an earlier one found.
	 */
	public function upsert(string $ip, ?string $mac, array $update): DeviceEntity {
		$mac = $mac !== null && $mac !== '' ? strtolower($mac) : null;
		if ($mac === null && isset($update['mac'])) {
			$mac = $update['mac'] !== null ? strtolower((string)$update['mac']) : null;
		}
		$key = $mac !== null ? $mac : 'ip:' . $ip;

		$device = $this->devices->findByKey($key);
		if ($device === null) {
			// Phases run in sequence and only some of them learn a MAC, so an
			// address already on file must attach to that row rather than
			// start a second one. When the MAC arrives later, the placeholder
			// row is re-keyed instead of being duplicated.
			$byIp = $this->devices->findByIp($ip);
			if ($byIp !== null && ($mac === null || $byIp->getMac() === null || $byIp->getMac() === $mac)) {
				if ($mac !== null) {
					$byIp->setDkey($key);
					$byIp->setMac($mac);
				}
				$device = $byIp;
			}
		}
		$isNew = $device === null;
		if ($isNew) {
			$device = new DeviceEntity();
			$device->setDkey($key);
			$device->setFirstSeen(time());
		}
		$device->setMac($mac ?? $device->getMac());
		$device->setIp($ip);
		$device->setOnline(true);
		$device->setLastSeen(time());

		if (!empty($update['hostname'])) {
			$device->setHostname($this->cleanName((string)$update['hostname']));
		}
		if (!empty($update['workgroup'])) {
			$device->setWorkgroup($this->cleanName((string)$update['workgroup']));
		}
		if (!empty($update['interface'])) {
			$device->setInterface((string)$update['interface']);
		}
		if (isset($update['ports']) && is_array($update['ports'])) {
			$device->setPorts($update['ports'] === [] ? null : implode(',', $update['ports']));
		}
		if (!empty($update['source'])) {
			$sources = array_filter(explode(',', (string)$device->getSources()));
			foreach (explode(',', (string)$update['source']) as $source) {
				if ($source !== '' && !in_array($source, $sources, true)) {
					$sources[] = $source;
				}
			}
			$device->setSources(implode(',', $sources));
		}

		$extra = $device->getExtra() ? (json_decode((string)$device->getExtra(), true) ?: []) : [];
		foreach (['mdns', 'wsd', 'ssdp', 'rdns'] as $field) {
			if (!empty($update[$field])) {
				$extra[$field] = (string)$update[$field];
			}
		}
		if ($extra !== []) {
			$device->setExtra(json_encode($extra, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
		}

		if ($mac !== null) {
			$described = $this->oui->describe($mac);
			$vendor = $described['vendor'];
			if ($vendor === '' && $described['local']) {
				$vendor = '__randomized__';
			}
			$device->setVendor($vendor !== '' ? $vendor : null);
		}

		$device->setDtype($this->classify($device));

		if (empty($device->getHostname()) && !empty($extra['rdns'])) {
			$device->setHostname($this->cleanName((string)$extra['rdns']));
		}

		return $isNew ? $this->devices->insert($device) : $this->devices->update($device);
	}

	/**
	 * Best guess at what a device is, from its open ports, vendor and names.
	 * Ports beat vendor: a Buffalo NAS and a Buffalo router share a prefix.
	 */
	public function classify(DeviceEntity $device): string {
		$ports = $device->getPorts() ? array_map('intval', explode(',', (string)$device->getPorts())) : [];
		$vendor = strtolower((string)$device->getVendor());
		$name = strtolower((string)$device->getHostname() . ' ' . (string)$device->getExtra());
		$has = static fn (int ...$p) => (bool)array_intersect($p, $ports);

		if ($has(9100, 515, 631)) {
			return 'printer';
		}
		if ($has(554, 8554) || preg_match('/hikvision|dahua|axis communications|panasonic i-pro|vivotek|reolink/', $vendor)) {
			return 'camera';
		}
		if ($has(445) && preg_match('/buffalo|synology|qnap|western digital|iodata|i-o data|netgear/', $vendor)) {
			return 'nas';
		}
		if ($has(5000, 5001) && $has(445)) {
			return 'nas';
		}
		if ($has(3389) || ($has(445, 139) && !$has(22))) {
			return 'pc';
		}
		if ($has(53) && $has(80, 443)) {
			return 'router';
		}

		$vendorMap = [
			'printer' => 'brother|epson|seiko epson|canon|ricoh|oki electric|kyocera|fuji xerox|fujifilm business|sharp corporation|konica minolta|zebra|star micronics',
			'router' => 'yamaha|buffalo|nec platforms|tp-link|d-link|netgear|aterm|cisco|juniper|fortinet|mikrotik|ubiquiti|allied telesis|elecom|asustek.*router',
			'phone' => 'apple.*iphone|xiaomi communications|oppo|vivo mobile|huawei device|samsung electro',
			'iot' => 'espressif|tuya|shelly|sonoff|itead|amazon technologies|google, inc|nest labs|switchbot|ampak|realtek semiconductor',
			'av' => 'sony|panasonic|lg electronics|sharp|toshiba|roku|bose|yamaha corporation of america|denon|onkyo',
			'sbc' => 'raspberry pi',
			'pc' => 'dell|hewlett packard|lenovo|micro-star|giga-byte|asustek|intel corporate|liteon|azurewave|cloud network technolog',
			'nas' => 'synology|qnap|western digital|netgear.*ready',
		];
		foreach ($vendorMap as $type => $pattern) {
			if ($vendor !== '' && preg_match('/' . $pattern . '/', $vendor)) {
				return $type;
			}
		}

		if (preg_match('/printer|print|mfp|-pr\b/', $name)) {
			return 'printer';
		}
		if ($has(22) && !$has(445)) {
			return 'server';
		}
		if ($has(80, 443)) {
			return 'host';
		}
		return $device->getDtype() ?: 'unknown';
	}

	// ---------------------------------------------------------------- helpers

	/** @return list<array> */
	private function devicesJson(): array {
		return array_map(static fn (DeviceEntity $d) => $d->jsonSerialize(), $this->devices->findAll());
	}

	private function planSize(string $target): int {
		if (str_contains($target, '/')) {
			[$net, $bits] = explode('/', $target, 2);
			$bits = (int)$bits;
			if (!filter_var($net, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) || $bits < 8 || $bits > 32) {
				return 0;
			}
			$size = 1 << (32 - $bits);
			return $size > 2 ? $size - 2 : $size;
		}
		return filter_var($target, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) ? 1 : 0;
	}

	/**
	 * The addresses at [$offset, $offset + $length) of the whole plan, without
	 * ever materialising the full list.
	 *
	 * @return list<string>
	 */
	private function addressSlice(array $plan, int $offset, int $length): array {
		$out = [];
		$seen = 0;
		foreach ($plan as $entry) {
			$size = (int)$entry['size'];
			if ($offset >= $seen + $size) {
				$seen += $size;
				continue;
			}
			$target = (string)$entry['target'];
			$localStart = max(0, $offset - $seen);
			if (!str_contains($target, '/')) {
				$out[] = $target;
			} else {
				[$net, $bits] = explode('/', $target, 2);
				$bits = (int)$bits;
				$base = ip2long($net) & (-1 << (32 - $bits));
				$blockSize = 1 << (32 - $bits);
				$first = $blockSize > 2 ? 1 : 0;
				for ($i = $localStart; $i < $size && count($out) < $length; $i++) {
					$out[] = long2ip($base + $first + $i);
				}
			}
			if (count($out) >= $length) {
				break;
			}
			$seen += $size;
			$offset = $seen;
		}
		return $out;
	}

	/**
	 * Pace the sweep against the kernel neighbour table.
	 *
	 * In 'safe' mode a slice never fills more than half the table, and the
	 * settle time gives the kernel room to retire the entries that did not
	 * answer before the next slice arrives. 'fast' mode lifts that cap; it is
	 * roughly three times quicker on a /16 but leans on forced garbage
	 * collection, so it is opt-in.
	 */
	/**
	 * The speeds a scan may be run at, as probes per second.
	 *
	 * The send rate is an accuracy setting, not only a pacing one. Every probe
	 * is an ARP broadcast, and Wi-Fi carries broadcasts slowly: pushing tens of
	 * thousands of packets per second reliably loses wireless devices that a
	 * calmer sweep finds every time. Measured on a /16 with ten devices,
	 * 20,000/s found six of them and 1,500/s found all ten — which is why the
	 * middle of this list is the default and not the end of it.
	 */
	public const PACE_RATES = [200, 500, 1500, 5000, 15000];

	public const PACE_DEFAULT = 1500;

	/** The old two-choice names, so a saved scan still means what it meant. */
	private const PACE_LEGACY = ['gentle' => 500, 'fast' => 1500];

	/** The rate meant by whatever the browser sent. */
	public function paceRate(string|int $mode): int {
		if (isset(self::PACE_LEGACY[(string)$mode])) {
			return self::PACE_LEGACY[(string)$mode];
		}
		$rate = (int)$mode;
		return in_array($rate, self::PACE_RATES, true) ? $rate : self::PACE_DEFAULT;
	}

	public function pacing(string|int $mode = self::PACE_DEFAULT): array {
		$limits = $this->discovery->neighbourLimits();
		$rate = $this->paceRate($mode);
		// The slice size is an accuracy setting too: the neighbour table holds
		// gc_thresh3 entries, and anything probed beyond that is evicted before
		// it can be read back. So a slice always stays well inside the table,
		// whatever the pace — a faster one simply sends each slice sooner and
		// waits less between them.
		$half = max(256, (int)floor($limits['gc3'] / 2));
		$quarter = max(64, (int)floor($limits['gc3'] / 4));
		// The slowest paces fill the table more gently and give slow devices
		// longer to answer; the fastest ones have nothing left to give.
		[$chunk, $settle] = match (true) {
			$rate <= 200 => [$quarter, 700],
			$rate <= 500 => [$quarter, 500],
			$rate <= 1500 => [$half, 300],
			$rate <= 5000 => [$half, 250],
			default => [$half, 200],
		};
		return ['chunk' => $chunk, 'settle' => $settle, 'rate' => $rate, 'limits' => $limits];
	}

	/**
	 * How a target compares with the neighbour table it will fill.
	 *
	 * Sweeping more addresses than gc_thresh3 makes the kernel force garbage
	 * collection — it still works, and the scan is still correct, but the
	 * kernel log fills with "neighbour table overflow" and a busy entry can be
	 * evicted. Slowing down does not avoid it, because the table only drains
	 * on the periodic GC cycle, so the honest fix is a larger table.
	 *
	 * @return array{ok: bool, hosts: int, gc3: int, advice: string}
	 */
	public function neighbourAdvice(array $targets): array {
		$hosts = 0;
		foreach ($targets as $target) {
			$hosts += $this->planSize((string)$target);
		}
		$limits = $this->discovery->neighbourLimits();
		return [
			'ok' => $hosts <= $limits['gc3'],
			'hosts' => $hosts,
			'gc3' => $limits['gc3'],
			'suggested' => max(1024, 2 ** (int)ceil(log(max(1024, $hosts * 2), 2))),
			'advice' => 'sysctl -w net.ipv4.neigh.default.gc_thresh3=' . max(1024, 2 ** (int)ceil(log(max(1024, $hosts * 2), 2)))
				. ' net.ipv4.neigh.default.gc_thresh2=' . (int)(max(1024, 2 ** (int)ceil(log(max(1024, $hosts * 2), 2))) / 2),
		];
	}

	private function normaliseOptions(array $options): array {
		// Three depths, because one list cannot serve every purpose: the short
		// one tells a printer from a camera without slowing the sweep, the long
		// one explains the device the short list does not, and the whole range
		// is there for the interface a maker hid on port 30443.
		$depth = in_array($options['portScan'] ?? 'common', ['common', 'detailed', 'wellKnown', 'all'], true)
			? (string)$options['portScan']
			: 'common';
		$default = match ($depth) {
			'all', 'wellKnown' => [],
			'detailed' => DiscoveryService::DETAILED_PORTS,
			default => DiscoveryService::FINGERPRINT_PORTS,
		};
		// The long ranges are built when they are needed rather than stored: a
		// thousand numbers do not belong in a scan's saved options, let alone
		// sixty-five thousand.
		$ports = in_array($depth, ['all', 'wellKnown'], true) ? [] : ($options['portList'] ?? $default);
		$ports = array_values(array_filter(array_map('intval', (array)$ports), static fn ($p) => $p > 0 && $p < 65536));
		$arpOnly = (bool)($options['arpOnly'] ?? false);
		$mode = $this->paceRate((string)($options['pace'] ?? self::PACE_DEFAULT));
		$pace = $this->pacing($mode);
		return [
			'pace' => $mode,
			'chunk' => max(64, min($pace['chunk'], (int)($options['chunk'] ?? $pace['chunk']))),
			'rate' => max(200, min(20000, (int)($options['rate'] ?? $pace['rate']))),
			'settle' => max(50, min(2000, (int)($options['settle'] ?? $pace['settle']))),
			'arpOnly' => $arpOnly,
			'names' => (bool)($options['names'] ?? true),
			'multicast' => (bool)($options['multicast'] ?? true),
			'ports' => (bool)($options['ports'] ?? true),
			'portScan' => $depth,
			// How long to wait for a port to answer. This, not the send rate,
			// is what decides how long a scan takes: a device that answers
			// nothing costs the whole wait for every 512 attempts.
			'portWait' => min(3.0, max(0.2, round((float)($options['portWait'] ?? 0.9), 2))),
			'rdns' => (bool)($options['rdns'] ?? true),
			'interface' => (string)($options['interface'] ?? ''),
			'portList' => $ports ?: $default,
		];
	}

	private function cleanName(string $name): string {
		$name = trim(preg_replace('/[\x00-\x1f\x7f]/', '', $name) ?? '');
		return mb_substr($name, 0, 255);
	}
}
