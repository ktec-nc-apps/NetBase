<?php
/**
 * Regression test: a type picked by hand survives when two rows for the same
 * device are folded into one (forum #72: a Synology picked as "NAS" turned back
 * into "Host" after a scan).
 *
 * mergeDuplicateIps() folds a MAC-less placeholder ("ip:<address>", how a
 * device beyond a router is first recorded) and the row with the device's MAC
 * into one, carrying across the name, notes, tags and the rest a person wrote.
 * The picked type was not among them: left on the row that was deleted, it was
 * lost, and the next guess took its place.
 *
 * Needs the Nextcloud autoloader for OCP\AppFramework\Db\Entity and QBMapper.
 * Run: php tests/picked_type_merge_test.php   (NC_ROOT=/var/www/nextcloud by default)
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/3rdparty/autoload.php';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Db/DeviceEntity.php';
require __DIR__ . '/../lib/Db/DeviceMapper.php';
require __DIR__ . '/../lib/Service/ScanService.php';

use OCA\NetBase\Db\DeviceEntity;
use OCA\NetBase\Db\DeviceMapper;
use OCA\NetBase\Service\ScanService;
use OCP\AppFramework\Db\Entity;

/** The rows in memory: just what mergeDuplicateIps() asks of the mapper. */
class FakeDevices extends DeviceMapper {
	/** @var array<int, DeviceEntity> */
	public array $rows = [];

	public function __construct() {
	}

	public function add(DeviceEntity $d): DeviceEntity {
		$d->setId(count($this->rows) + 1);
		$this->rows[$d->getId()] = $d;
		return $d;
	}

	public function findAllByIp(string $ip): array {
		return array_values(array_filter($this->rows, static fn (DeviceEntity $d) => $d->getIp() === $ip));
	}

	public function findAll(int $limit = 5000): array {
		return array_values($this->rows);
	}

	public function update(Entity $entity): Entity {
		$this->rows[$entity->getId()] = $entity;
		return $entity;
	}

	public function delete(Entity $entity): Entity {
		unset($this->rows[$entity->getId()]);
		return $entity;
	}
}

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  (got: $got)") . "\n";
	if (!$ok) { $fail++; }
};

$row = static function (string $ip, ?string $mac, string $type, string $ports, bool $picked): DeviceEntity {
	$d = new DeviceEntity();
	$d->setDkey($mac ?? 'ip:' . $ip);
	$d->setMac($mac);
	$d->setIp($ip);
	$d->setDtype($type);
	$d->setPorts($ports);
	$d->setFirstSeen(1000);
	if ($picked) {
		ScanService::markTypeChosen($d, $type);
	}
	return $d;
};

$merge = static function (FakeDevices $devices, DeviceEntity $keep): void {
	$ref = new ReflectionClass(ScanService::class);
	$scan = $ref->newInstanceWithoutConstructor();
	$ref->getProperty('devices')->setValue($scan, $devices);
	$m = $ref->getMethod('mergeDuplicateIps');
	$m->invoke($scan, $keep);
};

// The row with the MAC holds the pick; the placeholder is the one kept.
$devices = new FakeDevices();
$devices->add($row('192.168.100.20', '00:11:32:aa:bb:cc', 'nas', '5000,5001', true));
$keep = $devices->add($row('192.168.100.20', null, 'host', '80', false));
$merge($devices, $keep);
$left = array_values($devices->rows);
$check('the two rows became one', count($left) === 1, (string)count($left));
$check('the picked "NAS" is on the row that is left', ($left[0] ?? null)?->getDtype() === 'nas', (string)($left[0] ?? null)?->getDtype());
$check('and is still marked as picked, so the next scan keeps it', $left !== [] && ScanService::typeChosen($left[0]));

// The other way round: the kept row holds the pick already.
$devices = new FakeDevices();
$devices->add($row('192.168.100.21', null, 'host', '80', false));
$keep = $devices->add($row('192.168.100.21', '00:11:32:dd:ee:ff', 'nas', '5000', true));
$merge($devices, $keep);
$left = array_values($devices->rows);
$check('a pick on the kept row stays', count($left) === 1 && $left[0]->getDtype() === 'nas' && ScanService::typeChosen($left[0]));

// A guess on the deleted row is no pick: it does not override the kept row's guess.
$devices = new FakeDevices();
$devices->add($row('192.168.100.22', '00:11:32:00:00:01', 'nas', '5000', false));
$keep = $devices->add($row('192.168.100.22', null, 'printer', '9100', false));
$merge($devices, $keep);
$left = array_values($devices->rows);
$check('a guessed type on the deleted row is not carried as a pick', count($left) === 1 && !ScanService::typeChosen($left[0]));

echo $fail === 0 ? "\nALL PASS\n" : "\n$fail FAILED\n";
exit($fail === 0 ? 0 : 1);
