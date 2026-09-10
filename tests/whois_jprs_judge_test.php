<?php
/**
 * Regression test: judgeWhois() must read JPRS (.jp/.co.jp) answers.
 *
 * JPRS returns a "Domain Information" block whose fields carry a letter prefix
 * ("a. [Domain Name]", "p. [Name Server]"). The line-anchored "registered" check
 * never matched that, so a plainly registered name (google.co.jp) and a
 * suspended/pending-delete one (granz.co.jp) both came back "undecided" and were
 * then mislabelled as likely-free (△). A [Domain Name]/[State] block now means
 * taken (×); a bare "No match!!" still means free (○).
 *
 * Run: php tests/whois_jprs_judge_test.php
 */
require __DIR__ . '/../lib/Service/WhoisAvailabilityService.php';
$cls = \OCA\NetBase\Service\WhoisAvailabilityService::class;
$inst = (new ReflectionClass($cls))->newInstanceWithoutConstructor();
$m = new ReflectionMethod($cls, 'judgeWhois');
$m->setAccessible(true);
$judge = static fn (string $resp): array => $m->invoke($inst, $resp, 'No match!!');

$registered = "[ JPRS database ... ]\nDomain Information:\n"
	. "a. [Domain Name]                GRANZ.CO.JP\n"
	. "g. [Organization]               Suspended Domain Name\n"
	. "p. [Name Server]                \n"
	. "[State]                         Deleted (2026/10/31)\n";
$free = "[ JPRS database ... /e ... ]\n\nNo match!!\n";

$fail = 0;
$check = static function (string $name, bool $ok) use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name\n";
	if (!$ok) { $fail++; }
};

$r = $judge($registered);
$check('a registered/suspended .co.jp is taken (×)', $r[0] === '×');
$f = $judge($free);
$check('a "No match!!" .co.jp is free (○)', $f[0] === '○');

$lint = shell_exec('php -l ' . escapeshellarg(__DIR__ . '/../lib/Service/WhoisAvailabilityService.php') . ' 2>&1');
$check('service lints clean', strpos((string)$lint, 'No syntax errors') !== false);

echo $fail === 0 ? "\nALL PASS\n" : "\n$fail FAILED\n";
exit($fail === 0 ? 0 : 1);
