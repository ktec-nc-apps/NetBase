<?php
/**
 * Regression test: a container that comes back with a new MAC is the same
 * device when it gives the same name (GitHub #3).
 *
 * Docker 28 and Podman give a container a new random MAC on every start, and
 * the address may be another container's from before. NetBase told devices
 * apart by MAC only, and learned the name only in "Scan the network", so after
 * "Port scan" a restarted container became a new, unnamed device, and with the
 * addresses shuffled one container's ports were written on another's row.
 *
 * Checked here:
 *  - the name compared (nameKey): first label, lower case; nothing for a name
 *    made from the address;
 *  - when a new MAC is the same device (sameDeviceByName): only a random MAC
 *    or a device marked as a container, and only with the same name;
 *  - in the source: the names of new MACs are asked when the ARP table is
 *    read, the table is read again after the on-link check, silent addresses
 *    on a MAC that may change are touched again at the end, and the
 *    /proc/net/arp reader drops entries the kernel has not resolved.
 *
 * Needs the Nextcloud autoloader for OCP\AppFramework\Db\Entity.
 * Run: php tests/container_identity_test.php   (NC_ROOT=/var/www/nextcloud by default)
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/3rdparty/autoload.php';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Db/DeviceEntity.php';
require __DIR__ . '/../lib/Service/OuiService.php';
require __DIR__ . '/../lib/Service/ScanService.php';

use OCA\NetBase\Db\DeviceEntity;
use OCA\NetBase\Service\OuiService;
use OCA\NetBase\Service\ScanService;

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  (got: $got)") . "\n";
	if (!$ok) { $fail++; }
};

// ---------------------------------------------------------------- nameKey
$k = static fn (string $n, string $ip = '172.19.0.17') => ScanService::nameKey($n, $ip);
$check('a DNS name is compared by its first label', $k('mariadb00.lg.net') === 'mariadb00', $k('mariadb00.lg.net'));
$check('NetBIOS and DNS names of one device compare equal', $k('MARIADB00') === $k('mariadb00.lg.net.'));
$check('no name, no key', $k('') === '');
$check('"_gateway" is not a name', $k('_gateway') === '');
$check('a name made from the address is not a name (dashes)', $k('172-19-0-17.example.net') === '', $k('172-19-0-17.example.net'));
$check('a name made from the address is not a name (reversed)', $k('17.0.19.172.in-addr.arpa') === '', $k('17.0.19.172.in-addr.arpa'));
$check('a name made from the address is not a name (hex)', $k('host-ac130011.example') === '', $k('host-ac130011.example'));
$check('a name with a number of its own is a name', $k('redis5.lg.net') === 'redis5', $k('redis5.lg.net'));

// ---------------------------------------------------------------- sameDeviceByName
$oui = (new ReflectionClass(OuiService::class))->newInstanceWithoutConstructor();
$cache = new ReflectionProperty(OuiService::class, 'cache');
$cache->setValue($oui, ['8A1B2C3D4' => '', '001132AAB' => 'Synology', '001132AAC' => 'Synology']);
$scan = (new ReflectionClass(ScanService::class))->newInstanceWithoutConstructor();
(new ReflectionProperty(ScanService::class, 'oui'))->setValue($scan, $oui);
$same = new ReflectionMethod(ScanService::class, 'sameDeviceByName');

$row = static function (string $mac, string $host, ?string $type = null, array $extra = []): DeviceEntity {
	$d = new DeviceEntity();
	$d->setMac($mac);
	$d->setHostname($host);
	$d->setDtype($type);
	$d->setExtra($extra !== [] ? json_encode($extra) : null);
	return $d;
};
$ip = '172.19.0.17';
$random = '8a:1b:2c:3d:4e:5f';   // locally administered: a random MAC
$card = '00:11:32:aa:bb:02';     // burned into a network card

$r = $same->invoke($scan, $row('02:aa:bb:cc:dd:ee', 'mariadb00.lg.net', 'container'), $random, $ip, ['rdns' => 'mariadb00.lg.net']);
$check('random new MAC, same name: the same device', $r === true);
$r = $same->invoke($scan, $row('02:aa:bb:cc:dd:ee', 'redis01.lg.net', 'container'), $random, $ip, ['rdns' => 'redis02.lg.net']);
$check('random new MAC, another name: another device', $r === false);
$r = $same->invoke($scan, $row('02:aa:bb:cc:dd:ee', 'phone', 'phone', ['rdns' => 'pixel.lan']), $random, $ip, ['rdns' => 'Pixel.lan']);
$check('the name to compare may be the row\'s reverse-DNS name', $r === true);
$r = $same->invoke($scan, $row('00:11:32:aa:bb:01', 'raspberrypi', 'sbc'), $card, $ip, ['hostname' => 'raspberrypi']);
$check('a MAC burned into a card, same name: another machine (two "raspberrypi")', $r === false);
$marked = $row('00:11:32:aa:bb:01', 'web.lg.net', 'container');
$r = $same->invoke($scan, $marked, $card, $ip, ['rdns' => 'web.lg.net']);
$check('a device a person marked as a container is told by its name whatever its MAC', $r === true);
$r = $same->invoke($scan, $row('02:aa:bb:cc:dd:ee', '172-19-0-17.example.net', 'container'), $random, $ip, ['rdns' => '172-19-0-17.example.net']);
$check('a name made from the address proves nothing', $r === false);
$r = $same->invoke($scan, $row('02:aa:bb:cc:dd:ee', 'mariadb00.lg.net', 'container'), $random, $ip, ['source' => 'arp']);
$check('no name learned: not decided here', $r === false);

// ---------------------------------------------------------------- source
$src = (string)file_get_contents(__DIR__ . '/../lib/Service/ScanService.php');
$disc = (string)file_get_contents(__DIR__ . '/../lib/Service/DiscoveryService.php');
$fn = static function (string $code, string $head, int $len = 4000): string {
	$at = strpos($code, $head);
	return $at === false ? '' : substr($code, $at, $len);
};
$absorb = $fn($src, 'private function absorbNeighbours(', 2500);
$check('reading the ARP table asks the names of new MACs first', str_contains($absorb, 'namesOfNewMacs(') && str_contains($absorb, "\$update['rdns']"));
$upsert = $fn($src, 'public function upsert(', 3000);
$check('upsert keeps the row of a device that gives the same name', str_contains($upsert, 'sameDeviceByName('));
$live = $fn($src, 'private function confirmLiveness(', 3000);
$at = strpos($live, 'markOnline(');
$check('the ARP table is read again after the on-link check', $at !== false && strpos($live, 'absorbNeighbours(', $at) !== false);
$check('silent addresses on a MAC that may change are noted for a second touch', str_contains($live, 'planRecheck('));
$step = $fn($src, 'public function step(', 3500);
$check('the scan ends with the second touch when one is noted', str_contains($step, "'recheck' => \$this->stepRecheck(") && str_contains($step, "\$scan->setPhase('recheck')"));
$recheck = $fn($src, 'private function stepRecheck(', 3500);
$check('the second touch reads the ARP table and checks the ports of those that answered',
	str_contains($recheck, 'absorbNeighbours(') && str_contains($recheck, 'tcpSweep('));
$check('those still silent and given up by the kernel are set offline', str_contains($recheck, 'markOffline('));
$proc = $fn($disc, 'private function neighboursViaProc(', 2000);
$check('/proc/net/arp: an entry without ATF_COM (0x2) is not a device present', str_contains($proc, '& 0x2) === 0'));

echo $fail === 0 ? "\nall passed\n" : "\n$fail failed\n";
exit($fail === 0 ? 0 : 1);
