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

	/**
	 * How long a device that can only be heard stays listed after its last
	 * announcement.
	 *
	 * The listener runs every five minutes; this is generous against a late
	 * cron run rather than against the device, which announces itself every
	 * forty-five seconds. Something genuinely unplugged drops off the list
	 * within twenty minutes.
	 */
	public const HEARD_FOR = 1200;

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

		$normalised = $this->normaliseOptions($options);
		// The host limit guards the address-by-address sweep. In ARP-only mode
		// there is no sweep — only the kernel's neighbour table is read and its
		// entries (at most the ARP cache, ~1024) are touched — so the CIDR's size
		// is irrelevant. Enforcing it there wrongly rejected "Port scan" on a /16
		// network (e.g. 10.0.0.0/16 = 65536 > the limit), which is exactly the
		// common case: a home/office LAN that happens to be a /16.
		if (empty($normalised['arpOnly'])) {
			$maxHosts = (int)$this->config->getAppValue('netbase', 'max_hosts', '65536');
			if ($total > $maxHosts) {
				throw new \InvalidArgumentException('Scan target exceeds the configured limit of ' . $maxHosts . ' addresses');
			}
		}
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
		// What can only be heard, and was heard lately, is still here. It has
		// no way of answering a scan, so a scan cannot say otherwise.
		$this->devices->keepRecentlyHeard(time() - self::HEARD_FOR);
		// Fold together any address that ended up on more than one row before
		// now (a device whose MAC changed, or an older build that duplicated
		// it), so the list starts clean rather than only the addresses this
		// scan happens to re-find.
		$this->dedupeExisting();
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
				// The multicast step blocks for several seconds while it listens.
				// Announce that step and hand the response back first, so the
				// browser shows "listening" instead of freezing on the previous
				// step's label for the whole wait.
				if ($scan->getPhase() === 'mcast' && empty($queue['mcastAnnounced'])) {
					$queue['mcastAnnounced'] = true;
					$this->progress($scan, 'mcastListen', 0, 0);
					break;
				}
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
		$this->absorbSelf($queue, $options);
		$this->absorbNeighbours($queue, $options);
		// Reading the table cannot tell a device that is here now from one
		// powered off minutes ago — its entry lingers as STALE with the old MAC.
		// So confirm the addresses on file with a quick TCP touch (no range
		// walk): the ones still here answer and are marked online, the rest stay
		// offline. This is what makes a re-scan's online/offline current.
		$this->confirmLiveness($queue);
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

		if ($cursor === 0) {
			$this->absorbSelf($queue, $options);
		}
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
			// The walk resolves addresses new to the table, but a previously
			// known device that is now off leaves a stale entry the walk does
			// not clear. Confirm the on-file addresses by TCP so the gone ones
			// drop offline rather than lingering on their old MAC.
			$this->confirmLiveness($queue);
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
				if (!empty($update['hostname'])) {
					$update['nameFrom'] = 'netbios';
				}
			}
			if (isset($mdns[$ip])) {
				$name = preg_replace('/\.local$/i', '', $mdns[$ip]) ?? $mdns[$ip];
				if (empty($update['hostname'])) {
					$update['hostname'] = $name;
					$update['nameFrom'] = 'mdns';
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

	/**
	 * Listen, without scanning, for devices that can only announce themselves.
	 *
	 * A camera left on its factory 192.168.1.120 while this server is on
	 * 10.0.x shares the wire but not the network: it hears a question and its
	 * answer goes to a gateway that is not there. All that ever reaches us is
	 * its own unprompted announcement — measured at one every 45 seconds — so
	 * a scan's few-second listen finds it about one time in five. Sitting on
	 * the group for a minute finds it every time, which is a job for the
	 * background, not for someone waiting at the screen.
	 *
	 * @return list<string> the addresses heard
	 */
	public function listen(float $seconds = 50.0): array {
		$wires = [];
		foreach ($this->discovery->interfaces() as $if) {
			if ($if['loopback'] || !$if['up'] || $if['addresses'] === []) {
				continue;
			}
			foreach ($if['addresses'] as $addr) {
				if ($addr['family'] === 'inet') {
					$wires[] = ['index' => (int)$if['index'], 'ip' => $addr['ip']];
					break;
				}
			}
		}
		if ($wires === []) {
			return [];
		}
		$heard = [];
		$channels = $this->discovery->announcementChannels();
		foreach ($this->discovery->multicastHearMany($wires, $channels, $seconds) as $ip => $said) {
			$update = $this->fromAnnouncements($ip, $said);
			if ($update === []) {
				continue;
			}
			$this->upsert($ip, null, $update);
			$heard[] = $ip;
		}
		return array_values(array_unique($heard));
	}

	/**
	 * What a device's own announcements tell us about it.
	 *
	 * Nothing here was asked for and nothing here can be checked, so only what
	 * the device states about itself is recorded — its address, the dialect it
	 * speaks, and the port it says its own interface is on.
	 *
	 * @param list<array{port: int, body: string}> $said
	 */
	private function fromAnnouncements(string $ip, array $said): array {
		$update = [];
		$ports = [];
		foreach ($said as $one) {
			$body = $one['body'];
			switch ($one['port']) {
				case 1900:
					$where = preg_match('/^LOCATION:\s*(\S+)/mi', $body, $m) ? trim($m[1]) : '';
					$server = preg_match('/^SERVER:\s*(.+)$/mi', $body, $m2) ? trim($m2[1]) : '';
					$update['source'] = 'ssdp';
					if ($where !== '' || $server !== '') {
						$update['ssdp'] = trim($server . ' ' . $where);
					}
					// A device that cannot be reached can still be believed
					// about itself. The camera says where its own interface
					// is — port 49152, in one case — and that is worth
					// recording even though nothing here can connect to it.
					$told = $this->portFromUrl($where, $ip);
					if ($told !== null) {
						$ports[$told] = true;
					}
					// The kind of thing it is, when it names one.
					if (preg_match('#urn:schemas-upnp-org:device:([A-Za-z0-9]+):#', $body, $m3)) {
						$update['model'] = $m3[1];
					}
					break;
				case 3702:
					$update['source'] = 'wsd';
					if (preg_match('#<[^>]*Types[^>]*>(.*?)</[^>]*Types>#s', $body, $m)) {
						$update['wsd'] = trim($m[1]);
					}
					if (preg_match('#<[^>]*XAddrs[^>]*>(.*?)</[^>]*XAddrs>#s', $body, $m)) {
						foreach (preg_split('/\s+/', trim($m[1])) as $addr) {
							$told = $this->portFromUrl($addr, $ip);
							if ($told !== null) {
								$ports[$told] = true;
							}
						}
					}
					break;
				case 5353:
					$update['source'] = 'mdns';
					break;
				case 5355:
					$update['source'] = 'llmnr';
					break;
			}
		}
		if ($ports !== []) {
			$update['addPorts'] = array_map('intval', array_keys($ports));
			sort($update['addPorts']);
		}
		return $update;
	}

	/**
	 * What an SSDP announcement tells us about the device that sent it.
	 *
	 * @param list<string> $said
	 */
	private function fromAnnouncement(string $ip, array $said): array {
		$body = implode("\n", $said);
		$where = preg_match('/^LOCATION:\s*(\S+)/mi', $body, $m2) ? trim($m2[1]) : '';
		$update = [
			'source' => 'ssdp',
			'ssdp' => trim(
				(preg_match('/^SERVER:\s*(.+)$/mi', $body, $m) ? trim($m[1]) : '') . ' ' . $where
			),
		];
		// A device that cannot be reached can still be believed about itself.
		// The camera says where its own interface is — port 49152, in one
		// case — and that is worth recording even though nothing here can
		// connect to it.
		$told = $this->portFromUrl($where, $ip);
		if ($told !== null) {
			$update['addPorts'] = [$told];
		}
		return $update;
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
			// And what announces itself without being asked. A device on
			// another network sharing this wire — a camera left on its factory
			// 192.168.1.120 — hears the question but cannot answer it, because
			// our address is off its subnet and its reply goes to a gateway
			// that is not there. Its own announcements arrive regardless.
			$search = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n";
			foreach ($this->discovery->multicastHear($source, '239.255.255.250', 1900, 8.0, (int)$if['index'], $search) as $ip => $said) {
				$this->upsert($ip, null, $this->fromAnnouncement($ip, $said));
			}
			foreach ($this->discovery->multicastHear($source, '224.0.0.251', 5353, 1.5, (int)$if['index']) as $ip => $said) {
				$this->upsert($ip, null, ['source' => 'mdns']);
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
		$wait = (float)$options['portWait'];

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
	 * The port a device names in its own announcement, when the address in it
	 * is the device's own. Nothing is inferred: it is what the device said.
	 */
	private function portFromUrl(string $url, string $ip): ?int {
		if ($url === '' || preg_match('#^https?://([^/:]+)(?::(\d+))?#i', $url, $m) !== 1) {
			return null;
		}
		if ($m[1] !== $ip) {
			return null;
		}
		$port = isset($m[2]) && $m[2] !== '' ? (int)$m[2] : (str_starts_with(strtolower($url), 'https') ? 443 : 80);
		return $port > 0 && $port < 65536 ? $port : null;
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
			// And everything above it, which is where a maker hides a web
			// interface it would rather not advertise — 22401 on a router here.
			'high' => range(1025, 65535),
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

	/**
	 * This server, in its own list.
	 *
	 * A machine never asks the network for its own MAC address, so it is never
	 * in its own ARP table, and NetBase — which discovers by reading that table
	 * — could see every device on the network except the one it was running on.
	 * The kernel knows its own interfaces, so they are simply written down.
	 */
	private function absorbSelf(array &$queue, array $options): void {
		$known = array_flip($queue['ips'] ?? []);
		foreach ($this->discovery->interfaces() as $interface) {
			if ($interface['loopback'] || !$interface['up']) {
				continue;
			}
			if (($options['interface'] ?? '') !== '' && $interface['name'] !== $options['interface']) {
				continue;
			}
			foreach ($interface['addresses'] as $address) {
				if (($address['family'] ?? '') !== 'inet' || ($address['ip'] ?? '') === '') {
					continue;
				}
				$ip = (string)$address['ip'];
				// One NIC has one MAC but may hold several addresses (here eth0
				// carries 10.0.0.1 and 192.168.1.250). Keying each of them by the
				// shared MAC made them fight over a single row, so only the last
				// address kept "this server" and the others lost the badge. Each
				// of the server's own addresses is its own "this server" row,
				// keyed by IP; the MAC, when known, is still recorded for display.
				$this->upsert($ip, null, [
					'interface' => $interface['name'],
					'hostname' => gethostname() ?: null,
					'nameFrom' => 'self',
					'dtype' => 'server',
					'source' => 'self',
					'selfMac' => ($interface['mac'] ?? '') !== '' ? $interface['mac'] : null,
				]);
				if (!isset($known[$ip])) {
					$queue['ips'][] = $ip;
					$known[$ip] = true;
				}
			}
		}
	}

	/**
	 * Confirm which on-file addresses are actually here now, with a TCP touch,
	 * and mark those online. The neighbour table cannot answer this — a stale
	 * entry keeps a dead device's MAC — and priming does not refresh it, so the
	 * reliable, root-free test is whether the host answers a connection at all
	 * (open or refused). Off-link addresses are left to what they announce.
	 */
	private function confirmLiveness(array $queue): void {
		$ips = $queue['ips'] ?? [];
		foreach ($this->devices->findAll() as $d) {
			$ip = (string)$d->getIp();
			if ($ip !== '') {
				$ips[] = $ip;
			}
		}
		$ips = $this->discovery->onLinkOnly(array_values(array_unique($ips)));
		if ($ips === []) {
			return;
		}
		$this->devices->markOnline($this->discovery->alive($ips));
	}

	/** Read the ARP table and record everything new in it. */
	private function absorbNeighbours(array &$queue, array $options): void {
		$known = array_flip($queue['ips'] ?? []);
		foreach ($this->discovery->neighbours() as $ip => $entry) {
			if (($options['interface'] ?? '') !== '' && $entry['interface'] !== $options['interface']) {
				continue;
			}
			$this->upsert($ip, $entry['mac'], [
				'interface' => $entry['interface'],
				'source' => 'arp',
				// A stale ARP entry (a device powered off but not yet evicted)
				// keeps its old MAC, so it must not be counted as online; only a
				// neighbour the kernel has confirmed lately does. Older readers
				// without state say reachable=true, preserving prior behaviour.
				'present' => $entry['reachable'] ?? true,
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
			// An address is held by one device at a time. If it is already on a
			// row, take that row over rather than start a second one — even when
			// the MAC differs, which is exactly what a privacy (randomised) MAC
			// looks like each time it rotates. Otherwise every rotation, and
			// every phase that learns a MAC after one that did not, left another
			// row and the same IP appeared twice in the list.
			$byIp = $this->devices->findByIp($ip);
			// Attach to the row that holds this address only when it is the same
			// device — same MAC, or a MAC-less placeholder waiting for one. When
			// the address is now on a different MAC (a new machine took the
			// lease), start a fresh row rather than re-labelling the old device
			// as the new one; the stale row is removed by mergeDuplicateIps.
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
		// Only a positive signal turns a device online and updates "last seen";
		// the scan set everything offline at the start, so a "not present"
		// reading (a stale ARP entry) leaves both as they are rather than
		// claiming a powered-off device was seen just now.
		if ($update['present'] ?? true) {
			$device->setOnline(true);
			$device->setLastSeen(time());
		}
		$device->setMac($mac ?? $device->getMac());
		// The server's own MAC, recorded for display only: it is not the row's
		// key (a NIC's several addresses each get their own row), so it fills in
		// a blank without ever pulling two addresses onto one row.
		if (!empty($update['selfMac']) && ($device->getMac() === null || $device->getMac() === '')) {
			$device->setMac(strtolower((string)$update['selfMac']));
		}
		$device->setIp($ip);

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
		// A port a device announced is one to add to what is already known,
		// never the whole list. A scan speaks for every port it tried and may
		// take one away; an announcement speaks for one port only. Written as
		// the whole truth it wiped the rest: a camera here announces its own
		// page on port 49152 every forty-five seconds, so within a minute of
		// any scan the eight ports it had found were down to that one, and the
		// web-page search that followed had nothing left to try but 49152 and
		// never saw port 80.
		if (isset($update['addPorts']) && is_array($update['addPorts'])) {
			$known = array_values(array_filter(array_map(
				'intval',
				explode(',', (string)$device->getPorts()),
			)));
			foreach ($update['addPorts'] as $told) {
				$told = (int)$told;
				if ($told > 0 && $told < 65536 && !in_array($told, $known, true)) {
					$known[] = $told;
				}
			}
			sort($known);
			$device->setPorts($known === [] ? null : mb_substr(implode(',', $known), 0, 512));
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
		foreach (['mdns', 'wsd', 'ssdp', 'llmnr', 'rdns', 'model'] as $field) {
			if (!empty($update[$field])) {
				$extra[$field] = (string)$update[$field];
			}
		}
		// Which lookup produced the name that is shown, so a device can say how
		// it was identified. Recorded only when this update actually set a name.
		if (!empty($update['hostname']) && !empty($update['nameFrom'])) {
			$extra['nameFrom'] = (string)$update['nameFrom'];
		}

		// Look up the vendor from the row's actual MAC, not just the one passed
		// in: the server's own row learns its MAC through 'selfMac' with a null
		// $mac, and without this its vendor stayed blank ("Not registered").
		$effectiveMac = $device->getMac();
		if ($effectiveMac !== null && $effectiveMac !== '') {
			$described = $this->oui->describe($effectiveMac);
			$vendor = $described['vendor'];
			if ($vendor === '' && $described['local']) {
				$vendor = '__randomized__';
			}
			$device->setVendor($vendor !== '' ? $vendor : null);
		}

		$device->setDtype($this->classify($device));

		// Reverse DNS is the last resort for a name, so note it as the source.
		if (empty($device->getHostname()) && !empty($extra['rdns'])) {
			$device->setHostname($this->cleanName((string)$extra['rdns']));
			$extra['nameFrom'] = 'rdns';
		}

		if ($extra !== []) {
			$device->setExtra(json_encode($extra, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
		}

		$saved = $isNew ? $this->devices->insert($device) : $this->devices->update($device);
		$this->mergeDuplicateIps($saved);
		return $saved;
	}

	/**
	 * One row per address. A device whose MAC changes (a privacy address that
	 * rotates, or a lease handed to another machine) could leave an older row
	 * still holding the same IP; this folds any such row into the one that
	 * holds the address now, carrying across a user's own label and notes and
	 * the union of the ports and sources, then deletes it — so the list never
	 * shows the same IP twice.
	 */
	private function mergeDuplicateIps(DeviceEntity $keep): void {
		$ip = (string)$keep->getIp();
		if ($ip === '') {
			return;
		}
		$keepMac = ($keep->getMac() ?? '') !== '' ? $keep->getMac() : null;
		$changed = false;
		foreach ($this->devices->findAllByIp($ip) as $other) {
			if ($other->getId() === $keep->getId()) {
				continue;
			}
			$otherMac = ($other->getMac() ?? '') !== '' ? $other->getMac() : null;
			// Same device, or a MAC-less placeholder for it: carry across what
			// one copy knows and the other lacks. But two different MACs on one
			// address mean the address was handed to another machine (an old PC
			// giving up its lease to an Alexa): the departed device's name, type
			// and ports must NOT follow the address to the new occupant, so its
			// row is simply dropped.
			$sameDevice = $keepMac === null || $otherMac === null || $keepMac === $otherMac;
			if ($sameDevice) {
				if (!$keep->getLabel() && $other->getLabel()) { $keep->setLabel($other->getLabel()); $changed = true; }
				if (!$keep->getTags() && $other->getTags()) { $keep->setTags($other->getTags()); $changed = true; }
				if (!$keep->getNotes() && $other->getNotes()) { $keep->setNotes($other->getNotes()); $changed = true; }
				if (!$keep->getHostname() && $other->getHostname()) { $keep->setHostname($other->getHostname()); $changed = true; }
				if ($other->getKnown() && !$keep->getKnown()) { $keep->setKnown(true); $changed = true; }
				$ports = $this->mergePortList((string)$keep->getPorts(), (string)$other->getPorts());
				if ($ports !== (string)$keep->getPorts()) { $keep->setPorts($ports === '' ? null : $ports); $changed = true; }
				$sources = $this->mergeCsvSet((string)$keep->getSources(), (string)$other->getSources());
				if ($sources !== (string)$keep->getSources()) { $keep->setSources($sources === '' ? null : $sources); $changed = true; }
				if ($keep->getFirstSeen() !== null && $other->getFirstSeen() !== null && $other->getFirstSeen() < $keep->getFirstSeen()) {
					$keep->setFirstSeen($other->getFirstSeen());
					$changed = true;
				}
			}
			$this->devices->delete($other);
		}
		if ($changed) {
			$keep->setDtype($this->classify($keep));
			$this->devices->update($keep);
		}
	}

	/**
	 * Fold every duplicated address down to one row. The survivor is the row
	 * that is online, then the one with a MAC, then the most recently seen — so
	 * the live device keeps the row and the stale copy is absorbed into it.
	 */
	public function dedupeExisting(): void {
		foreach ($this->devices->duplicateIps() as $ip) {
			$rows = $this->devices->findAllByIp($ip);
			if (count($rows) < 2) {
				continue;
			}
			usort($rows, static function (DeviceEntity $a, DeviceEntity $b): int {
				$ao = $a->getOnline() ? 1 : 0;
				$bo = $b->getOnline() ? 1 : 0;
				if ($ao !== $bo) {
					return $bo - $ao;
				}
				$am = ($a->getMac() ?? '') !== '' ? 1 : 0;
				$bm = ($b->getMac() ?? '') !== '' ? 1 : 0;
				if ($am !== $bm) {
					return $bm - $am;
				}
				return (int)$b->getLastSeen() - (int)$a->getLastSeen();
			});
			$this->mergeDuplicateIps($rows[0]);
		}
	}

	/** Union of two comma-separated port lists, as sorted numbers. */
	private function mergePortList(string $a, string $b): string {
		$ports = [];
		foreach (array_merge(explode(',', $a), explode(',', $b)) as $p) {
			$p = (int)trim($p);
			if ($p > 0 && $p < 65536 && !in_array($p, $ports, true)) {
				$ports[] = $p;
			}
		}
		sort($ports);
		return mb_substr(implode(',', $ports), 0, 512);
	}

	/** Union of two comma-separated string sets, order preserved. */
	private function mergeCsvSet(string $a, string $b): string {
		$out = [];
		foreach (array_merge(explode(',', $a), explode(',', $b)) as $s) {
			$s = trim($s);
			if ($s !== '' && !in_array($s, $out, true)) {
				$out[] = $s;
			}
		}
		return implode(',', $out);
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
		// A device out of reach has no ports to judge it by, but it says what
		// it is in its own announcement, and that is worth believing.
		if (preg_match('/digitalsecuritycamera|networkcamera|ipcam/', $name)) {
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
		$depth = in_array($options['portScan'] ?? 'common', ['common', 'detailed', 'wellKnown', 'high', 'all'], true)
			? (string)$options['portScan']
			: 'common';
		$default = match ($depth) {
			'all', 'wellKnown', 'high' => [],
			'detailed' => DiscoveryService::DETAILED_PORTS,
			default => DiscoveryService::FINGERPRINT_PORTS,
		};
		// The long ranges are built when they are needed rather than stored: a
		// thousand numbers do not belong in a scan's saved options, let alone
		// sixty-five thousand.
		$ports = in_array($depth, ['all', 'wellKnown', 'high'], true) ? [] : ($options['portList'] ?? $default);
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
