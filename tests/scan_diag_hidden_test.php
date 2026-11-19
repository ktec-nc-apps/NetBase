<?php
/**
 * Regression test: the record of a diagnosed scan shows no device name and no
 * whole MAC address (GitHub #4).
 *
 * The scan's record ("What the scan did") is made to be pasted into a report,
 * and the page says it holds no device names and no MAC addresses. Lines added
 * since 0.9.14 (a container back with a new MAC, a row taken back by its name,
 * the names asked of new devices) put both in it. Checked here, against the real
 * ScanService with an in-memory mapper:
 *  - a MAC shows only its first three bytes, whatever the line;
 *  - a name is shown as a label ("name-1"), the same one every time, also
 *    where it turns up in a line that did not register it;
 *  - the labels are kept in the scan's queue between steps, so they mean the
 *    same name in every request of one scan;
 *  - the paths that write such lines (a MAC that changed under the same name,
 *    a row set aside and taken back, a row folded into the row of its name)
 *    leave nothing readable in the record;
 *  - outside a diagnosis nothing is recorded and a name is left as it is.
 *
 * Run: php tests/scan_diag_hidden_test.php   (NC_ROOT=/var/www/nextcloud by default)
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
$row = static function (int $id, ?string $ip, string $mac, string $name, ?string $ports, string $type = 'unknown', bool $picked = false): DeviceEntity {
	$d = new DeviceEntity();
	$d->setId($id); $d->setIp($ip); $d->setMac($mac); $d->setDkey($mac); $d->setHostname($name);
	$d->setPorts($ports); $d->setFirstSeen(100); $d->setLastSeen(100); $d->setOnline($ip !== null);
	$d->setDtype($type); $d->setSources('arp,rdns');
	if ($picked) { ScanService::markTypeChosen($d, $type); }
	return $d;
};
$prop = static fn (string $n) => new ReflectionProperty(ScanService::class, $n);
$world = static function (MemDevices $m, ?array $trace): ScanService {
	$s = (new ReflectionClass(ScanService::class))->newInstanceWithoutConstructor();
	(new ReflectionProperty(ScanService::class, 'devices'))->setValue($s, $m);
	(new ReflectionProperty(ScanService::class, 'gateway'))->setValue($s, '172.19.0.1');
	(new ReflectionProperty(ScanService::class, 'trace'))->setValue($s, $trace);
	(new ReflectionProperty(ScanService::class, 'traceNames'))->setValue($s, []);
	return $s;
};
$call = static fn (ScanService $s, string $method, ...$args) => (new ReflectionMethod(ScanService::class, $method))->invoke($s, ...$args);
$text = static fn (ScanService $s): string => implode("\n", (array)(new ReflectionProperty(ScanService::class, 'trace'))->getValue($s));
$leaks = static function (string $t, array $names): array {
	$bad = [];
	if (preg_match_all('/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/i', $t, $m)) { $bad = array_merge($bad, $m[0]); }
	foreach ($names as $n) { if (stripos($t, $n) !== false) { $bad[] = $n; } }
	return $bad;
};

// ------------------------------------------------ the two helpers
$s = $world(new MemDevices(), []);
$call($s, 'note', 'mac 92:f1:03:07:08:e6 was fa:ad:56:a4:e5:bc and 92-F1-03-07-08-E6');
$call($s, 'note', 'MAC aa:bb:cc:dd:ee:ff, gone now');
$t = $text($s);
$check('a MAC keeps its first three bytes only', str_contains($t, '92:f1:03:xx:xx:xx') && str_contains($t, 'fa:ad:56:xx:xx:xx') && str_contains($t, 'aa:bb:cc:xx:xx:xx'), $t);
$check('also written with dashes', str_contains($t, '92-F1-03-xx-xx-xx'), $t);
$check('and no whole MAC is left', $leaks($t, []) === [], implode(',', $leaks($t, [])));
$a = $call($s, 'who', 'redis-node2.lg.net');
$b = $call($s, 'who', 'haproxy.lg.net');
$check('a name gets a label, the same one each time, another name another', $a === 'name-1' && $b === 'name-2' && $call($s, 'who', 'REDIS-node2.lg.net ') === 'name-1', "$a $b");
$call($s, 'note', 'another line that mentions redis-node2.lg.net and Haproxy.lg.net by name');
$check('a name met before is hidden wherever it turns up', str_contains($text($s), 'mentions name-1 and name-2 by name'), $text($s));
$check('the long and the short form of a name share a label', $call($s, 'who', 'redis-node2') === 'name-1' && $call($s, 'who', 'haproxy') === 'name-2');
$call($s, 'note', 'the short one, redis-node2, is hidden too');
$check('and each form is hidden as written', str_contains($text($s), 'the short one, name-1, is hidden too'), $text($s));
$call($s, 'who', 'web.lan'); $call($s, 'who', 'myweb.lan');
$call($s, 'note', 'rows myweb.lan and web.lan');
$check('the longer name is replaced whole', str_contains($text($s), 'rows name-4 and name-3'), $text($s));
$check('an empty name stays empty', $call($s, 'who', '') === '' && $call($s, 'who', '  ') === '');
$off = $world(new MemDevices(), null);
$check('outside a diagnosis a name is left as it is and nothing is recorded', $call($off, 'who', 'lg7s.lg.net') === 'lg7s.lg.net' && (new ReflectionProperty(ScanService::class, 'trace'))->getValue($off) === null);

// ------------------------------------------------ the labels live in the scan's queue
$src = file_get_contents(__DIR__ . '/../lib/Service/ScanService.php');
$check('the labels are saved to the queue at the start of a scan and after each step', substr_count($src, "\$queue['diagNames'] = \$this->traceNames;") === 2);
$check('and read back before the next step', str_contains($src, "\$this->traceNames = is_array(\$queue['diagNames'] ?? null) ? \$queue['diagNames'] : [];"));
$check('and begin empty with a new scan', str_contains($src, "\$this->traceNames = [];\n\t\t\t\$this->traceT0 = microtime(true);"));

// ------------------------------------------------ the paths that write them, run for real
$names = ['lg7s.lg.net', 'lg7p.lg.net', 'mariadb03.lg.net', 'bd-web.lg.net'];
// a row folded into the row of its name, and one taken back by its name later
$m = new MemDevices();
$keep = $m->add($row(1, '172.19.0.5', 'dd:00:00:00:00:01', 'mariadb03.lg.net', null));
$m->add($row(2, '172.19.0.5', 'dd:00:00:00:00:02', 'bd-web.lg.net', '80'));
$m->add($row(3, '172.19.0.6', 'dd:00:00:00:00:03', 'bd-web.lg.net', null));
$s = $world($m, []);
$call($s, 'mergeDuplicateIps', $keep);
$check('a row folded into the row of its name: it says so', str_contains($text($s), 'folded into the row of its name'), $text($s));
$m = new MemDevices();
$keep = $m->add($row(1, '172.19.0.5', 'dd:00:00:00:00:01', 'mariadb03.lg.net', null));
$m->add($row(2, '172.19.0.5', 'dd:00:00:00:00:02', 'bd-web.lg.net', '80'));
$s = $world($m, []);
$call($s, 'mergeDuplicateIps', $keep);
$back = $m->add($row(3, '172.19.0.6', 'dd:00:00:00:00:03', 'bd-web.lg.net', null));
$call($s, 'adoptParked', $back);
$t = $text($s);
$check('a row taken back by its name: the line is there, under a label', str_contains($t, 'took back the ports') && preg_match('/name-\d+ took back/', $t) === 1, $t);
$check('no name and no whole MAC in any of it', $leaks($t, $names) === [], implode(',', $leaks($t, $names)));
// the lines that name a device (the upsert path needs the whole service; it is run in the Podman test bed)
foreach ([
	'names asked the new devices' => ['names asked (%d ms)', '$this->who((string)$n)'],
	'a MAC that changed under the same name' => ["\$this->who((string)(\$update['rdns'] ?? \$update['hostname'] ?? \$update['mdns'] ?? '') ?: (string)\$byIp->getHostname()) . ': the same device", null],
	'a row moved to a new address' => ["same name ' . \$this->who((string)\$moved->getHostname())", null],
	'a row left behind' => ["the row ' . \$this->who((string)\$name) . ' left on", null],
	'a row taken back' => ["\$this->who((string)\$d->getHostname()) . ' took back", null],
] as $what => $needles) {
	$ok = true;
	foreach (array_filter($needles) as $n) { $ok = $ok && str_contains($src, $n); }
	$check('the line for ' . $what . ' goes through who()', $ok);
}

echo $fail ? "\n$fail FAILED\n" : "\nALL PASS\n";
exit($fail ? 1 : 0);
