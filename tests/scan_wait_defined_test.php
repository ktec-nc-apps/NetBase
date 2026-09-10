<?php
/**
 * Regression test: ScanService::stepPorts() must assign $wait BEFORE it is
 * first read. It used to read $wait on the budget line while the assignment
 * sat several lines below, so every port-scan step logged
 *   "Undefined variable $wait at .../ScanService.php"
 * and computed the port budget from a null wait (0.1 → a 9× over-budget).
 * Seen in production on kida and yamafuji during the port-80 investigation.
 *
 * Token-based so it needs nothing but PHP: it walks the tokens of stepPorts()
 * and fails if $wait is used before it is assigned in that function body.
 *
 * Run: php tests/scan_wait_defined_test.php
 */
$src = file_get_contents(__DIR__ . '/../lib/Service/ScanService.php');
if ($src === false) { fwrite(STDERR, "cannot read ScanService.php\n"); exit(2); }

// Isolate the body of stepPorts() by brace matching from its signature.
$pos = strpos($src, 'function stepPorts(');
if ($pos === false) { fwrite(STDERR, "stepPorts() not found\n"); exit(2); }
$brace = strpos($src, '{', $pos);
$depth = 0; $end = $brace;
for ($i = $brace, $n = strlen($src); $i < $n; $i++) {
	if ($src[$i] === '{') { $depth++; }
	elseif ($src[$i] === '}') { $depth--; if ($depth === 0) { $end = $i; break; } }
}
$body = substr($src, $brace, $end - $brace + 1);

// First assignment of $wait vs first bare read of $wait.
$assign = preg_match('/\$wait\s*=/', $body, $m1, PREG_OFFSET_CAPTURE) ? $m1[0][1] : PHP_INT_MAX;
// A read: $wait not immediately followed by '=' (but allow '==' which is a read).
$read = PHP_INT_MAX;
if (preg_match_all('/\$wait\b\s*(=?=?)/', $body, $all, PREG_OFFSET_CAPTURE)) {
	foreach ($all[1] as $k => $g) {
		$op = $g[0];
		if ($op === '=') { continue; } // assignment, not a read
		$read = min($read, $all[0][$k][1]);
	}
}

$fail = 0;
$ok = $assign !== PHP_INT_MAX && $assign <= $read;
echo ($ok ? "PASS" : "FAIL") . "  \$wait is assigned before it is read in stepPorts()\n";
if (!$ok) { $fail++; echo "  assign at offset $assign, first read at offset $read\n"; }

// And the file must be syntactically valid.
$lint = shell_exec('php -l ' . escapeshellarg(__DIR__ . '/../lib/Service/ScanService.php') . ' 2>&1');
$lintOk = strpos((string)$lint, 'No syntax errors') !== false;
echo ($lintOk ? "PASS" : "FAIL") . "  ScanService.php lints clean\n";
if (!$lintOk) { $fail++; echo "  $lint\n"; }

echo $fail === 0 ? "\nALL PASS\n" : "\n$fail FAILED\n";
exit($fail === 0 ? 0 : 1);
