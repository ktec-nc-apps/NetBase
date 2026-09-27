<?php
/**
 * Regression test: what classify() makes of real device names and makers.
 *
 * A maker's name alone used to decide "router": Buffalo, TP-Link and NETGEAR sell
 * switches, NAS and smart plugs too, so a Buffalo BSL-WS-G2116M switch and a TP-Link
 * Tapo P110M plug both came out as Wi-Fi routers, and an eufyCam (Espressif radio)
 * as something else again. Model names now decide first, and a router needs a reason
 * (a DNS service) rather than a maker. A Nintendo Switch is a game console, not an L2
 * switch.
 *
 * Run: php tests/classify_names_test.php   (NC_ROOT=/var/www/nextcloud by default)
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/3rdparty/autoload.php';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Db/DeviceEntity.php';
require __DIR__ . '/../lib/Service/ScanService.php';

use OCA\NetBase\Db\DeviceEntity;
use OCA\NetBase\Service\ScanService;

$scan = (new ReflectionClass(ScanService::class))->newInstanceWithoutConstructor();
$fail = 0;
$case = static function (string $want, string $host, string $vendor, string $ports = '', string $label = '') use ($scan, &$fail): void {
	$d = new DeviceEntity();
	$d->setHostname($host);
	$d->setLabel($label);
	$d->setVendor($vendor);
	$d->setPorts($ports);
	$got = $scan->classify($d);
	$ok = $got === $want;
	echo ($ok ? 'PASS' : 'FAIL') . "  $host / $vendor" . ($ports !== '' ? " / $ports" : '') . " -> $want" . ($ok ? '' : "  (got: $got)") . "\n";
	if (!$ok) { $fail++; }
};

// the three that were wrong on a real site
$case('switch', 'BSL-WS-G2116M', 'BUFFALO.INC', '80');
$case('plug', 'Tapo_P110M', 'TP-LINK TECHNOLOGIES CO.,LTD.');
$case('camera', 'eufyCam-C35', 'Espressif Inc.');
// switch families that say "switch" nowhere
$case('switch', 'GS308E', 'NETGEAR');
$case('switch', 'TL-SG108E', 'TP-LINK TECHNOLOGIES CO.,LTD.', '80');
$case('switch', 'SWX2310P-10G', 'YAMAHA CORPORATION', '80');
// a maker alone is no longer a router
$r = (function () use ($scan) { $d = new DeviceEntity(); $d->setHostname(''); $d->setVendor('BUFFALO.INC'); $d->setPorts(''); return $scan->classify($d); })();
echo ($r !== 'router_wifi' && $r !== 'router' ? 'PASS' : 'FAIL') . "  a Buffalo device with nothing else to go on is not called a router  (got: $r)\n";
if ($r === 'router_wifi' || $r === 'router') { $fail++; }
// routers still found when there is a reason
$case('router_wifi', 'WSR-3200AX4S', 'BUFFALO.INC', '53,80');
$case('router_wifi', 'RT-AX88U', 'ASUSTek COMPUTER INC.', '53,80,443');
$case('router', 'NVR500', 'YAMAHA CORPORATION', '80');
// names that must not be caught by the new rules
$case('game', 'Nintendo Switch', 'Nintendo Co.,Ltd');
$case('smarthub', 'SwitchBot-Hub-Mini-A1B2', 'Espressif Inc.');
$case('mediaplayer', 'living-chromecast', 'Google, Inc.', '8008,8009');
$case('nas', 'LS220D', 'BUFFALO.INC', '80,445');
$case('light', 'Tapo_L530E', 'TP-LINK TECHNOLOGIES CO.,LTD.');
// the model number is often only in the name a person typed (no host name announced)
$case('switch', '', 'BUFFALO.INC', '80', 'BSL-WS-G2116M');
$case('plug', '', 'TP-Link Systems Inc', '80', 'Tapo P110M');
$case('ap', '', 'BUFFALO.INC', '22,23,80,443', 'WAPM-1266R');
$case('smarthub', '', 'Espressif Inc', '', 'SwitchBot HUB');

echo "\n" . ($fail ? "$fail FAILED\n" : "ALL PASS\n");
exit($fail ? 1 : 0);
