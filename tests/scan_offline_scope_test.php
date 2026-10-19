<?php
/**
 * Regression test: a scan sets back to "offline" only the devices inside the
 * ranges it looks at (ScanService::start, idsWithin, inPlan).
 *
 * Reported on the forum (NetBase thread #59, 2026-10-18): with two LANs,
 * 192.168.20.0/24 and 192.168.40.0/24, re-scanning one of them turned every
 * device of the other one offline. start() called markAllOffline(), which set
 * the whole list offline, and only what the new scan found came back online.
 *
 * The two functions are taken out of ScanService.php and run here, so the
 * test needs nothing but PHP; it also checks that start() uses them.
 *
 * Run: php tests/scan_offline_scope_test.php
 */
$src = file_get_contents(__DIR__ . '/../lib/Service/ScanService.php');
$fn = function (string $name) use ($src): string {
	$pos = strpos($src, 'public static function ' . $name . '(');
	if ($pos === false) { fwrite(STDERR, "$name() not found\n"); exit(2); }
	$brace = strpos($src, '{', $pos);
	for ($i = $brace, $d = 0, $n = strlen($src); $i < $n; $i++) {
		if ($src[$i] === '{') { $d++; } elseif ($src[$i] === '}' && --$d === 0) { break; }
	}
	return substr($src, $pos, $i - $pos + 1);
};
eval('final class S { ' . $fn('idsWithin') . ' ' . $fn('inPlan') . ' ' . $fn('mergePorts') . ' }');
$fail = 0;
$ok = function (bool $c, string $m) use (&$fail): void { echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) { $fail++; } };
$dev = fn (int $id, ?string $ip) => new class($id, $ip) { public function __construct(private int $id, private ?string $ip) {} public function getId(): int { return $this->id; } public function getIp(): ?string { return $this->ip; } };
$devices = [$dev(1, '192.168.20.5'), $dev(2, '192.168.20.254'), $dev(3, '192.168.40.7'), $dev(4, '172.18.0.3'), $dev(5, null), $dev(6, '10.0.3.9')];

$ok(S::idsWithin($devices, [['target' => '192.168.20.0/24', 'size' => 254]]) === [1, 2], 'scanning .20 touches only the .20 devices');
$ok(S::idsWithin($devices, [['target' => '192.168.40.0/24', 'size' => 254]]) === [3], 'scanning .40 touches only the .40 device');
$ok(S::idsWithin($devices, [['target' => '192.168.20.0/24', 'size' => 254], ['target' => '172.18.0.0/24', 'size' => 254]]) === [1, 2, 4], 'two targets at once');
$ok(S::idsWithin($devices, [['target' => '192.168.40.7', 'size' => 1]]) === [3], 'a single address');
$ok(S::idsWithin($devices, [['target' => '10.0.0.0/16', 'size' => 65534]]) === [6], 'a /16');
$ok(!in_array(5, S::idsWithin($devices, [['target' => '0.0.0.0/0', 'size' => 1]]), true), 'a device without an address (kept aside) is never touched');
$ok(S::inPlan([['target' => '192.168.20.0/24']], '192.168.21.1') === false && S::inPlan([['target' => '192.168.20.0/23']], '192.168.21.1') === true, 'the mask is applied, not the text');
$ok(S::inPlan([['target' => '192.168.20.0/24']], 'not-an-ip') === false, 'something that is not an address is outside');

// ports: only what was tried is decided; a sweep where nothing answered keeps what was known (#59)
$common = array_flip([22, 80, 443, 445]);
$ok(S::mergePorts('22,80,443,8080,32400', [22, 443], $common) === [22, 443, 8080, 32400], 'a short-list sweep keeps the ports it did not try (8080, 32400) and drops 80, tried and closed');
$ok(S::mergePorts('80,443,8443', [], $common) === [80, 443, 8443], 'a sweep where nothing answered changes nothing');
$ok(S::mergePorts(null, [22, 80], $common) === [22, 80], 'a new device gets what answered');
$ok(S::mergePorts('22', [22, 9000], array_flip(range(1, 65535))) === [22, 9000], 'a full sweep decides every port');
$ok(str_contains($src, '\'portsTested\' => $tested'), 'the port step passes what it tried');

$start = substr($src, strpos($src, 'public function start('), 6000);
$ok(!str_contains($start, 'markAllOffline()') && str_contains($start, 'markOffline(self::idsWithin('), 'start() no longer sets every device offline');
echo $fail ? "$fail FAILED\n" : "ALL OK\n";
exit($fail ? 1 : 0);
