<?php
/**
 * Devices beyond this server's own subnets — NetBase in a bridged container.
 *
 * In Nextcloud AIO (and any Docker or Podman install on a bridge) the server
 * sits on 172.x and the LAN is reached through NAT. Nothing on the LAN is
 * on-link, so the neighbour (ARP) table that the sweep reads holds only the
 * other containers, and a scan of the LAN found nothing at all (NCC #44/#47,
 * NetBase 0.8.0 on AIO 34.0.4, Synology DSM 7.4.1). Device windows and port
 * scans open only from a device in the list, so nothing else worked either.
 *
 * Checked here:
 * 1. The sweep finds off-link addresses by a completed TCP connection (a
 *    refusal across a router may come from the router, so it does not count),
 *    waits long enough for a device in power save to answer the retry, and
 *    drops a batch in which every address answered (something in between is
 *    answering for all of them).
 * 2. Only on-link addresses are primed for ARP; off-link ones are probed.
 * 3. The liveness check covers off-link devices found earlier.
 * 4. A device can be added by address, only within the local network.
 * 5. A device found that way can be pinged (private range, not only on-link).
 *
 * Run: php tests/offlink_discovery_test.php   (NB_ROOT=<tree> to test another copy)
 */
$root = getenv('NB_ROOT') ?: dirname(__DIR__);

$fail = 0;
$check = static function (string $name, bool $ok) use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name\n";
	if (!$ok) {
		$fail++;
	}
};
$fn = static function (string $src, string $sig, int $len = 4000): string {
	$at = strpos($src, $sig);
	return $at === false ? '' : substr($src, $at, $len);
};

$disc = (string)file_get_contents($root . '/lib/Service/DiscoveryService.php');
$scan = (string)file_get_contents($root . '/lib/Service/ScanService.php');
$api = (string)file_get_contents($root . '/lib/Controller/ApiController.php');
$tool = (string)file_get_contents($root . '/lib/Service/ToolService.php');
$routes = (string)file_get_contents($root . '/appinfo/routes.php');
$js = (string)file_get_contents($root . '/js/netbase.js');

// ---- 1. finding a device beyond the subnet --------------------------------
$reach = $fn($disc, 'public function reachBeyond(', 1200);
$check('DiscoveryService has reachBeyond()', $reach !== '');
$check('it counts only completed connections (tcpSweep reports open ports)', str_contains($reach, '$this->tcpSweep('));
$check('it does not use alive(), which counts a refusal as a device', !str_contains($reach, '$this->alive('));
preg_match('/function reachBeyond\(array \$ips, float \$timeout = ([0-9.]+)\)/', $disc, $m);
$check('its default wait covers a SYN retry (>= 1.5 s)', isset($m[1]) && (float)$m[1] >= 1.5);
$check('a batch in which every address answered is dropped', (bool)preg_match('/count\(\$found\) === count\(\$ips\)\)\s*\{\s*return \[\];/', $reach));
$check('it tries the ports home devices keep open (NAS 5000, Sonos 1400, Cast 8008)',
	(bool)preg_match('/REACH_PORTS = \[[^\]]*\b5000\b[^\]]*\b1400\b[^\]]*\b8008\b/', $disc));
$check('DiscoveryService has offLinkOnly()', str_contains($disc, 'public function offLinkOnly('));

// ---- 2. the sweep -----------------------------------------------------------
$sweep = $fn($scan, 'private function stepSweep(', 3000);
$check('the sweep splits the slice into on-link and off-link', str_contains($sweep, '$this->discovery->offLinkOnly($ips)'));
$check('it probes the off-link part', str_contains($sweep, '$this->discovery->reachBeyond($beyond)'));
$check('it primes only the on-link part', str_contains($sweep, 'primeNeighbours($near'));
$check('an off-link step takes fewer addresses', str_contains($sweep, 'self::BEYOND_CHUNK'));
$absorb = $fn($scan, 'private function absorbReached(', 900);
$check('found devices are recorded with no MAC, as source tcp, and join the scan',
	str_contains($absorb, "upsert((string)\$ip, null, ['source' => 'tcp'") && str_contains($absorb, "\$queue['ips'][]"));

// ---- 3. liveness ------------------------------------------------------------
$live = $fn($scan, 'private function confirmLiveness(', 1500);
$check('the liveness check also covers off-link devices', str_contains($live, 'offLinkOnly(') && str_contains($live, 'reachBeyond('));

// ---- 4. adding by address ---------------------------------------------------
$check('POST /api/devices is routed to addDevice', (bool)preg_match("/'api#addDevice', 'url' => '\\/api\\/devices', 'verb' => 'POST'/", $routes));
$add = $fn($api, 'public function addDevice(', 1800);
$check('addDevice accepts only an IPv4 literal', str_contains($add, 'FILTER_VALIDATE_IP') && str_contains($add, 'FILTER_FLAG_IPV4'));
$check('addDevice refuses an address outside the local network', str_contains($add, 'isLocalTarget($ip)'));
$check('addDevice needs the scan permission', str_contains($add, "}, 'scan');"));
$check('the device list has an "Add by address" button', str_contains($js, "t('Add by address')") && str_contains($js, '@click="openAddDevice"'));
$check('the add dialog does not close on an outside click', (bool)preg_match('/<div v-if="addDev.open" class="drawer-backdrop centred">/', $js));

// ---- 5. ping ---------------------------------------------------------------
$ping = $fn($tool, 'public function pingDevice(', 900);
$check('a device in a private range beyond the bridge can be pinged', str_contains($ping, 'isLocalTarget($ip)'));

echo $fail === 0 ? "ALL PASS\n" : "$fail FAILED\n";
exit($fail === 0 ? 0 : 1);
