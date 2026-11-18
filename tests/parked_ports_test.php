<?php
/**
 * Regression test: a container whose row was set aside when the addresses
 * were shuffled by a reboot gets its ports back with its row (GitHub #4).
 *
 * After a boot lg7s came back on lg7p's old address and lg7p on lg7s's. The
 * row of lg7p was set aside (ip = null) until its name turned up, and when it
 * did, only what a person wrote (name, notes, picked type) went to the new
 * row: the ports stayed behind and were deleted with the parked row, so the
 * device showed no ports until the next port scan.
 *
 * Checked here, against the real ScanService with an in-memory mapper:
 *  - adoptParked: the ports, the picked type and the first sighting go to the
 *    row found under the same name, and the parked row is removed;
 *  - mergeDuplicateIps: an older row on the address, of another machine with
 *    a row of its own elsewhere, gives that row its ports as well;
 *  - an address handed to a machine of another name still does not take the
 *    old machine's ports (carryOwn alone).
 *
 * Run: php tests/parked_ports_test.php   (NC_ROOT=/var/www/nextcloud by default)
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/3rdparty/autoload.php';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Db/DeviceEntity.php';
require __DIR__ . '/../lib/Db/DeviceMapper.php';
require __DIR__ . '/../lib/Service/OuiService.php';
require __DIR__ . '/../lib/Service/ScanService.php';

use OCA\NetBase\Db\DeviceEntity;
use OCA\NetBase\Db\DeviceMapper;
use OCA\NetBase\Service\ScanService;
use OCP\AppFramework\Db\Entity;

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  (got: $got)") . "\n";
	if (!$ok) { $fail++; }
};

/** The table, in memory: only what these paths of ScanService call. */
class MemDevices extends DeviceMapper {
	/** @var array<int, DeviceEntity> */
	public array $rows = [];
	public function __construct() {}
	public function add(DeviceEntity $d): DeviceEntity { $this->rows[(int)$d->getId()] = $d; return $d; }
	public function findAll(int $limit = 5000): array { return array_values($this->rows); }
	public function findAllByIp(string $ip): array { return array_values(array_filter($this->rows, static fn ($d) => (string)$d->getIp() === $ip)); }
	public function findParked(): array { return array_values(array_filter($this->rows, static fn ($d) => ($d->getIp() ?? '') === '' && ($d->getHostname() ?? '') !== '')); }
	public function update(Entity $entity): Entity { $this->rows[(int)$entity->getId()] = $entity; return $entity; }
	public function delete(Entity $entity): Entity { unset($this->rows[(int)$entity->getId()]); return $entity; }
}

$row = static function (int $id, ?string $ip, string $mac, string $name, ?string $ports, int $first, string $type = 'unknown', bool $picked = false): DeviceEntity {
	$d = new DeviceEntity();
	$d->setId($id); $d->setIp($ip); $d->setMac($mac); $d->setDkey($mac); $d->setHostname($name);
	$d->setPorts($ports); $d->setFirstSeen($first); $d->setLastSeen($first); $d->setOnline($ip !== null);
	$d->setDtype($type); $d->setSources('arp,rdns');
	if ($picked) { ScanService::markTypeChosen($d, $type); }
	return $d;
};
$world = static function (MemDevices $m): ScanService {
	$s = (new ReflectionClass(ScanService::class))->newInstanceWithoutConstructor();
	(new ReflectionProperty(ScanService::class, 'devices'))->setValue($s, $m);
	(new ReflectionProperty(ScanService::class, 'gateway'))->setValue($s, '172.19.0.1');
	return $s;
};
$call = static fn (ScanService $s, string $method, ...$args) => (new ReflectionMethod(ScanService::class, $method))->invoke($s, ...$args);

// ------------------------------------------------ adoptParked (GitHub #4: lg7p on .7)
$m = new MemDevices();
$m->add($row(1, null, '36:41:5b:23:77:cd', 'lg7p.lg.net', '22,80', 100, 'container', true));
$found = $m->add($row(2, '172.19.0.7', '2e:a3:97:af:06:7d', 'lg7p.lg.net', null, 500));
$s = $world($m);
$call($s, 'adoptParked', $found);
$now = $m->rows[2] ?? null;
$check('the parked row is folded in and removed', $now !== null && !isset($m->rows[1]), implode(',', array_keys($m->rows)));
$check('the ports come back with the row', $now !== null && $now->getPorts() === '22,80', (string)($now ? $now->getPorts() : ''));
$check('the picked type comes back, as before', $now !== null && $now->getDtype() === 'container' && ScanService::typeChosen($now), (string)($now ? $now->getDtype() : ''));
$check('the first sighting is the older one', $now !== null && (int)$now->getFirstSeen() === 100, (string)($now ? $now->getFirstSeen() : ''));

// ports found now are kept beside the old ones
$m = new MemDevices();
$m->add($row(1, null, 'aa:00:00:00:00:01', 'mariadb02.lg.net', '3306,4567', 100, 'container', true));
$found = $m->add($row(2, '172.19.0.4', 'aa:00:00:00:00:02', 'mariadb02.lg.net', '22', 500));
$call($world($m), 'adoptParked', $found);
$check('ports seen now and ports on file are joined', ($m->rows[2] ?? null)?->getPorts() === '22,3306,4567', (string)(($m->rows[2] ?? null)?->getPorts()));

// a parked row of another name is left alone
$m = new MemDevices();
$m->add($row(1, null, 'aa:00:00:00:00:01', 'lg7s.lg.net', '22,80', 100, 'container', true));
$found = $m->add($row(2, '172.19.0.7', 'aa:00:00:00:00:02', 'lg7p.lg.net', null, 500));
$call($world($m), 'adoptParked', $found);
$check('a parked row of another name stays parked', isset($m->rows[1]) && ($m->rows[2]->getPorts() ?? '') === '', (string)$m->rows[2]->getPorts());

// ------------------------------------------------ mergeDuplicateIps: the older row's machine has a row elsewhere
$m = new MemDevices();
$keep = $m->add($row(1, '172.19.0.8', 'bb:00:00:00:00:01', 'lg7s.lg.net', '22,80', 300, 'container', true));
$old = $m->add($row(2, '172.19.0.8', 'bb:00:00:00:00:02', 'lg7p.lg.net', '22,80,8080', 100, 'container', true));
$old->setNotes('the web front');
$home = $m->add($row(3, '172.19.0.7', 'bb:00:00:00:00:03', 'lg7p.lg.net', null, 500));
$call($world($m), 'mergeDuplicateIps', $keep);
$check('the older row is gone from the address', !isset($m->rows[2]));
$check('its notes go to the row of its name', ($m->rows[3] ?? null)?->getNotes() === 'the web front');
$check('its ports go to the row of its name', ($m->rows[3] ?? null)?->getPorts() === '22,80,8080', (string)(($m->rows[3] ?? null)?->getPorts()));
$check('the row kept on the address keeps only its own ports', $m->rows[1]->getPorts() === '22,80', (string)$m->rows[1]->getPorts());

// nothing written on the older row: its ports still go to the row of its name
$m = new MemDevices();
$keep = $m->add($row(1, '172.19.0.5', 'dd:00:00:00:00:01', 'mariadb03.lg.net', null, 300));
$old = $m->add($row(2, '172.19.0.5', 'dd:00:00:00:00:02', 'bd-web.lg.net', '80', 100));
$home = $m->add($row(3, '172.19.0.6', 'dd:00:00:00:00:03', 'bd-web.lg.net', null, 500));
$call($world($m), 'mergeDuplicateIps', $keep);
$check('with nothing written on it, its ports still go to the row of its name', !isset($m->rows[2]) && ($m->rows[3] ?? null)?->getPorts() === '80', (string)(($m->rows[3] ?? null)?->getPorts()));
$check('and the first sighting with them', (int)(($m->rows[3] ?? null)?->getFirstSeen()) === 100);

// with nothing written on it and no row of its name yet, it is removed, not set aside (as before)
$m = new MemDevices();
$keep = $m->add($row(1, '172.19.0.5', 'dd:00:00:00:00:01', 'mariadb03.lg.net', null, 300));
$m->add($row(2, '172.19.0.5', 'dd:00:00:00:00:02', 'bd-web.lg.net', '80', 100));
$call($world($m), 'mergeDuplicateIps', $keep);
$check('with nothing written on it and no row of its name, it is removed, not set aside', count($m->rows) === 1 && isset($m->rows[1]));

// ...but when the machine of that name turns up on another address in the same request
// (a reboot: the containers' addresses are shuffled all at once), its ports come back
$m = new MemDevices();
$keep = $m->add($row(1, '172.19.0.5', 'dd:00:00:00:00:01', 'mariadb03.lg.net', null, 300));
$m->add($row(2, '172.19.0.5', 'dd:00:00:00:00:02', 'bd-web.lg.net', '80', 100));
$s = $world($m);
$call($s, 'mergeDuplicateIps', $keep);
$back = $m->add($row(3, '172.19.0.6', 'dd:00:00:00:00:03', 'bd-web.lg.net', null, 500));
$call($s, 'adoptParked', $back);
$check('a row removed in this request gives its ports to its name on the new address', ($m->rows[3] ?? null)?->getPorts() === '80' && !isset($m->rows[2]), (string)(($m->rows[3] ?? null)?->getPorts()));
$other = $m->add($row(4, '172.19.0.9', 'dd:00:00:00:00:04', 'bd-web.lg.net', null, 600));
$call($s, 'adoptParked', $other);
$check('and only once', ($m->rows[4]->getPorts() ?? '') === '', (string)$m->rows[4]->getPorts());
$fresh = $world($m);
$m2 = new MemDevices();
$keep = $m2->add($row(1, '172.19.0.5', 'dd:00:00:00:00:01', 'mariadb03.lg.net', null, 300));
$m2->add($row(2, '172.19.0.5', 'dd:00:00:00:00:02', 'bd-web.lg.net', '80', 100));
$call($world($m2), 'mergeDuplicateIps', $keep);
$later = $m2->add($row(3, '172.19.0.6', 'dd:00:00:00:00:03', 'bd-web.lg.net', null, 500));
$call($world($m2), 'adoptParked', $later);
$check('not in a later request: nothing is kept between requests', ($m2->rows[3]->getPorts() ?? '') === '', (string)$m2->rows[3]->getPorts());

// ------------------------------------------------ the gateway with a new MAC (GitHub #4, second report)
// A Docker bridge's address comes back with another MAC and no name: the row is
// new and the old one is folded in. What a person wrote went along; the ports did
// not, and showed empty until the next port scan.
$m = new MemDevices();
$keep = $m->add($row(1, '172.19.0.1', 'ee:00:00:00:00:01', '', null, 500));
$old = $m->add($row(2, '172.19.0.1', 'ee:00:00:00:00:02', '', '22,80,443', 100, 'gateway', true));
$old->setNotes('the host');
$call($world($m), 'mergeDuplicateIps', $keep);
$check('the gateway row with the old MAC is folded in', count($m->rows) === 1 && isset($m->rows[1]));
$check('the gateway keeps its ports', ($m->rows[1]->getPorts() ?? '') === '22,80,443', (string)$m->rows[1]->getPorts());
$check('and its first sighting', (int)$m->rows[1]->getFirstSeen() === 100, (string)$m->rows[1]->getFirstSeen());
$check('and the notes and the picked type, as before', $m->rows[1]->getNotes() === 'the host' && $m->rows[1]->getDtype() === 'gateway' && ScanService::typeChosen($m->rows[1]));
// only the gateway: another address without a name still gets nothing
$m = new MemDevices();
$keep = $m->add($row(1, '172.19.0.40', 'ee:00:00:00:00:11', '', null, 500));
$m->add($row(2, '172.19.0.40', 'ee:00:00:00:00:12', '', '22,80', 100, 'pc', true));
$call($world($m), 'mergeDuplicateIps', $keep);
$check('an address that is not the gateway, with no name, takes no ports', ($m->rows[1]->getPorts() ?? '') === '', (string)$m->rows[1]->getPorts());

// ------------------------------------------------ an address handed to a machine of another name
$m = new MemDevices();
$keep = $m->add($row(1, '10.0.0.20', 'cc:00:00:00:00:01', 'alexa', null, 500));
$old = $m->add($row(2, '10.0.0.20', 'cc:00:00:00:00:02', 'old-pc', '139,445,3389', 100, 'pc', true));
$old->setNotes('retired');
$call($world($m), 'mergeDuplicateIps', $keep);
$check('the new occupant does not take the old machine\'s ports', ($m->rows[1]->getPorts() ?? '') === '', (string)$m->rows[1]->getPorts());
$check('nor its notes', ($m->rows[1]->getNotes() ?? '') === '');

echo $fail ? "\n$fail FAILED\n" : "\nALL PASS\n";
exit($fail ? 1 : 0);
