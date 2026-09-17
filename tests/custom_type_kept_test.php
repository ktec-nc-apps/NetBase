<?php
/**
 * Regression test: a device type the user typed in their own words must
 * survive a scan.
 *
 * The type picker offers templates (Server, Printer, ...) and "Other", where
 * the user writes their own ("Container"). classify() ran on every scan update
 * and replaced the stored type whenever a rule matched, so a container with
 * port 22 open went straight back to "server". A type outside the templates is
 * now kept; the templates themselves are still guessed as before.
 *
 * It also checks that the picker's templates in js/netbase.js (TYPE_LABEL) are
 * exactly ScanService::AUTO_TYPES — a template missing from AUTO_TYPES would be
 * treated as the user's own words and never re-guessed.
 *
 * Needs the Nextcloud autoloader for OCP\AppFramework\Db\Entity.
 * Run: php tests/custom_type_kept_test.php   (NC_ROOT=/var/www/nextcloud by default)
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/3rdparty/autoload.php';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Db/DeviceEntity.php';
require __DIR__ . '/../lib/Service/ScanService.php';

use OCA\NetBase\Db\DeviceEntity;
use OCA\NetBase\Service\ScanService;

$scan = (new ReflectionClass(ScanService::class))->newInstanceWithoutConstructor();
$device = static function (?string $type, string $ports, string $vendor = ''): DeviceEntity {
	$d = new DeviceEntity();
	$d->setDtype($type);
	$d->setPorts($ports);
	$d->setVendor($vendor);
	return $d;
};

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  (got: $got)") . "\n";
	if (!$ok) { $fail++; }
};

$r = $scan->classify($device('Container', '22,80'));
$check('a typed "Container" with port 22 stays "Container"', $r === 'Container', $r);
$r = $scan->classify($device('コンテナ', '9100'));
$check('a typed Japanese type stays even when a printer port is open', $r === 'コンテナ', $r);
$r = $scan->classify($device('container', '22,80,443'));
$check('the "container" template (hand-picked only) stays on a scan', $r === 'container', $r);
$r = $scan->classify($device(null, '22'));
$check('no type yet: port 22 is still guessed as "server"', $r === 'server', $r);
$r = $scan->classify($device('server', '9100'));
$check('a template type is still re-guessed (server → printer on 9100)', $r === 'printer', $r);
$r = $scan->classify($device('camera', ''));
$check('a template type with nothing to judge by is kept', $r === 'camera', $r);

// The picker's templates and AUTO_TYPES must be the same set.
$js = (string)file_get_contents(__DIR__ . '/../js/netbase.js');
preg_match('/const TYPE_LABEL = \{(.*?)\};/s', $js, $m);
preg_match_all('/(\w+):\s*\'/', $m[1] ?? '', $keys);
$jsKeys = $keys[1];
sort($jsKeys);
$auto = array_merge(ScanService::AUTO_TYPES, ScanService::MANUAL_TYPES);
sort($auto);
$check('TYPE_LABEL templates in netbase.js match AUTO_TYPES + MANUAL_TYPES', $jsKeys === $auto, implode(',', $jsKeys));
$check('no template is both guessed and hand-picked', array_intersect(ScanService::AUTO_TYPES, ScanService::MANUAL_TYPES) === []);

// ---------------------------------------------------------------------------
// A container that restarts comes back with a new MAC, and often a new address
// too. Where the address is the same, the row is rebuilt under the new MAC and
// the old one is dropped — and until this was fixed, the type went with it, so
// "Container" reverted to "Unknown" on every restart. Reproduced with podman:
// same address, new MAC, and the hand-picked type was gone.
//
// What a person typed now follows the address; what the scan guessed does not,
// because a guess describes the machine that left, not the address.
$source = (string)file_get_contents(__DIR__ . '/../lib/Service/ScanService.php');
$at = strpos($source, 'private function mergeDuplicateIps');
// The function's real end, not a guessed character count: a window measured in
// characters silently stopped short of the branch once the comment above it
// grew, and every check below passed on an empty string instead of failing.
$ends = array_filter([
	strpos($source, "\n\tprivate function ", (int)$at + 10),
	strpos($source, "\n\tpublic function ", (int)$at + 10),
], static fn ($p) => $p !== false);
$merge = $at === false ? '' : substr($source, $at, ($ends === [] ? strlen($source) : min($ends)) - $at);
$split = strpos($merge, '} else {');
$other = $split === false ? '' : substr($merge, $split);
$check('the branch was actually located (not an empty window)', $other !== '' && strlen($other) > 200, strlen($other) . ' chars');

$check('mergeDuplicateIps has a branch for a different MAC on the same address', $split !== false);
$check('the name a person gave it is carried across', str_contains($other, '$keep->setLabel($other->getLabel())'));
$check('their notes are carried across', str_contains($other, '$keep->setNotes($other->getNotes())'));
$check('their tags are carried across', str_contains($other, '$keep->setTags($other->getTags())'));
$check('a hand-picked type is carried across', str_contains($other, '$keep->setDtype($chosen)'));
$check(
	'but only when it is hand-picked, never a guessed one',
	str_contains($other, '!in_array($chosen, self::AUTO_TYPES, true)'),
	'no AUTO_TYPES guard on the carried type'
);
$check(
	'and only when the new row has no type of its own',
	str_contains($other, 'in_array($hasOwn, self::AUTO_TYPES, true)')
);
// What the departed machine reported about itself must not follow the address.
foreach (['setPorts', 'setHostname', 'setWorkgroup', 'setVendor', 'setKnown'] as $keepsOut) {
	$check("the old machine's $keepsOut() is not carried across", !str_contains($other, '$keep->' . $keepsOut . '($other->'));
}

foreach (['lib/Service/ScanService.php', 'lib/Controller/ApiController.php'] as $file) {
	$lint = shell_exec('php -l ' . escapeshellarg(__DIR__ . '/../' . $file) . ' 2>&1');
	$check("$file lints clean", strpos((string)$lint, 'No syntax errors') !== false);
}

echo $fail === 0 ? "\nALL PASS\n" : "\n$fail FAILED\n";
exit($fail === 0 ? 0 : 1);
