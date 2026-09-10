<?php
/**
 * Regression test for the DNS tool's CAA lookup. dns_get_record()'s second
 * argument must be a DNS_* bitmask constant; the code once mapped CAA to the
 * on-the-wire type number 257, which PHP 8 rejects with a ValueError — and the
 * @ operator does not suppress a ValueError, so a query that included CAA blew
 * up the whole DNS request ("Argument #2 ($type) must be a DNS_* constant").
 *
 * The fix (ToolService::dns) maps CAA to DNS_CAA. This checks that every type
 * the tool offers is accepted by dns_get_record without a ValueError, shows the
 * raw 257 still throws (why the bug happened), and guards the source so CAA
 * cannot quietly go back to 257.
 *
 * Run: php tests/dns_caa_type_test.php   (needs nothing but PHP; no network —
 * the ValueError, if any, is raised while validating the argument, before any
 * lookup, so a non-resolving host is enough.)
 */

$fail = 0;
$check = static function (string $name, bool $ok) use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . '  ' . $name . "\n";
	if (!$ok) { $fail++; }
};

// The exact type map ToolService::dns() uses.
$all = ['A' => DNS_A, 'AAAA' => DNS_AAAA, 'CNAME' => DNS_CNAME, 'MX' => DNS_MX, 'NS' => DNS_NS, 'TXT' => DNS_TXT, 'SOA' => DNS_SOA, 'SRV' => DNS_SRV, 'CAA' => DNS_CAA, 'PTR' => DNS_PTR];

$host = 'netbase-nonexistent.invalid'; // RFC 6761 reserved; never resolves.

// 1. Every offered type is accepted (no ValueError from the argument).
foreach ($all as $type => $const) {
	$threw = false;
	try {
		@dns_get_record($host, $const);
	} catch (\ValueError $e) {
		$threw = true;
	}
	$check("type $type is a valid dns_get_record constant", !$threw);
}

// 2. Contrast: the old raw wire number 257 is exactly what PHP 8 rejects.
$oldThrew = false;
try {
	@dns_get_record($host, 257);
} catch (\ValueError $e) {
	$oldThrew = true;
}
$check('raw 257 throws ValueError (the original bug)', $oldThrew);

// 3. Source guard: CAA must map to DNS_CAA, never back to 257.
$src = file_get_contents(__DIR__ . '/../lib/Service/ToolService.php');
$check("ToolService maps 'CAA' => DNS_CAA", str_contains($src, "'CAA' => DNS_CAA"));
$check("ToolService no longer maps 'CAA' => 257", !str_contains($src, "'CAA' => 257"));

echo $fail ? "\n$fail check(s) FAILED\n" : "\nall checks passed\n";
exit($fail ? 1 : 0);
