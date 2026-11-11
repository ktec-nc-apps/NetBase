<?php
/**
 * Regression test: this server's own row moves with the server and never takes
 * another device's row (GitHub #3).
 *
 * In a container, Nextcloud may start again on an address another container
 * held until then (.9 -> .8, where lg7s had been). The server's row is written
 * from its interfaces without a MAC to compare, so it took the row on that
 * address: lg7s's type picked by hand, its notes and its name went to the
 * server's row, and lg7s came back as a new device guessed "Server machine".
 *
 * Checked here:
 *  - which rows are this server's (isSelfRow);
 *  - in the source: a device that started again on another address keeps
 *    its row (rowMovedHere, adoptLeftBehind);
 *  - in the source: the server's row does not take a row with another MAC,
 *    it moves from an address the server no longer holds, it shows the MAC it
 *    has now, mergeDuplicateIps keeps the server's row and another device's
 *    apart, and a device on a new address is asked its name while a row waits
 *    for it.
 * The whole flow was run in the Podman test bed (/root/nbtestbed).
 *
 * Needs the Nextcloud autoloader for OCP\AppFramework\Db\Entity.
 * Run: php tests/self_row_moves_test.php   (NC_ROOT=/var/www/nextcloud by default)
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/3rdparty/autoload.php';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Db/DeviceEntity.php';
require __DIR__ . '/../lib/Service/ScanService.php';

use OCA\NetBase\Db\DeviceEntity;
use OCA\NetBase\Service\ScanService;

$fail = 0;
$check = static function (string $name, bool $ok) use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name\n";
	if (!$ok) { $fail++; }
};
$row = static function (?string $sources): DeviceEntity {
	$d = new DeviceEntity();
	$d->setSources($sources);
	return $d;
};
$check('a row written from the interfaces is this server\'s', ScanService::isSelfRow($row('self')));
$check('also when the network saw it too', ScanService::isSelfRow($row('arp,rdns,self')));
$check('a row found on the network is not', !ScanService::isSelfRow($row('arp,rdns')));
$check('a row without sources is not', !ScanService::isSelfRow($row(null)));
$check('a source that only contains the word is not', !ScanService::isSelfRow($row('selfish')));

$src = file_get_contents(__DIR__ . '/../lib/Service/ScanService.php');
$fn = static function (string $head, int $len) use ($src): string {
	$at = strpos($src, $head);
	return $at === false ? '' : substr($src, $at, $len);
};
$self = $fn('private function absorbSelf(', 2600);
$check('the server passes every address it holds now', str_contains($self, "'ownIps' => \$own"));
$upsert = $fn('public function upsert(', 4500);
$check('the server\'s row does not take a row with another MAC',
	str_contains($upsert, "(\$update['source'] ?? '') === 'self'") && str_contains($upsert, '!self::isSelfRow($byIp)') && str_contains($upsert, '$byIp = null;'));
$check('the server\'s row moves from an address it has left', str_contains($upsert, 'selfRowLeft($update)'));
$check('the server\'s row shows the MAC it has now', str_contains($src, "(\$update['source'] ?? '') === 'self' && self::isSelfRow(\$device)"));
$left = $fn('private function selfRowLeft(', 900);
$check('only a row on an address the server holds on no interface now', str_contains($left, '!in_array($at, $own, true)') && str_contains($left, 'self::isSelfRow($d)'));
$merge = $fn('private function mergeDuplicateIps(', 2500);
$check('the server\'s row and a row with a MAC of its own are two devices', str_contains($merge, 'self::isSelfRow($keep) !== self::isSelfRow($other)'));
$names = $fn('private function namesOfNewMacs(', 1500);
$check('a new address is asked its name while a row waits, or for a random MAC',
	str_contains($names, 'findParked()') && str_contains($names, "\$was === null && (\$waiting || \$this->oui->describe(\$mac)['local'])"));

// A container that started again on another address (a free one) keeps its row.
$check('upsert takes the row a device left on its old address', str_contains($upsert, 'rowMovedHere($mac, $ip, $update)'));
$moved = $fn('private function rowMovedHere(', 1200);
$check('only by the same name, only when its old MAC is gone, only one row, never the server\'s',
	str_contains($moved, 'sameDeviceByName(') && str_contains($moved, 'isset($this->macsNow[$old])')
	&& str_contains($moved, 'count($found) === 1') && str_contains($moved, 'self::isSelfRow($d)'));
$check('nothing is moved before the ARP table has been read', str_contains($moved, '$this->macsNow === null'));
$behind = $fn('private function adoptLeftBehind(', 1600);
$check('a row left behind while its old MAC still showed is folded in later',
	str_contains($src, '$this->adoptLeftBehind($saved);') && str_contains($behind, 'carryOwn($old, $d)') && str_contains($behind, 'delete($old)'));

echo $fail === 0 ? "all passed\n" : "$fail failed\n";
exit($fail === 0 ? 0 : 1);
