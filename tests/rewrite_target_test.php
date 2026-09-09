<?php
/**
 * Regression test for BUG2: the _top/_parent/_blank target rewrite must not
 * reach inside a <script>. An ASUS router's WAN page builds HTML in a JS
 * string; rewriting a target= there breaks the script's quoting and the page's
 * labels never render. This checks the fix (ProxyService::rewriteTargets) and,
 * for contrast, shows the old whole-body regex corrupts the same input.
 *
 * Run: php tests/rewrite_target_test.php   (needs nothing but PHP)
 */
require __DIR__ . '/../lib/Service/ProxyService.php';

$m = new ReflectionMethod(\OCA\NetBase\Service\ProxyService::class, 'rewriteTargets');
$m->setAccessible(true);
$rewrite = static fn (string $s): string => $m->invoke(null, $s);

// The old, buggy transform, for contrast only.
$oldRewrite = static function (string $s): string {
	$s = preg_replace('#\btarget\s*=\s*(["\'])\s*_(top|parent|blank)\s*\1#i', 'target="_netbase_window"', $s) ?? $s;
	return preg_replace('#\btarget\s*=\s*_(top|parent|blank)(?=[\s>])#i', 'target=_netbase_window', $s) ?? $s;
};

$fail = 0;
$check = static function (string $name, bool $ok) use (&$fail): void {
	echo ($ok ? "PASS" : "FAIL") . "  " . $name . "\n";
	if (!$ok) { $fail++; }
};

// 1. A genuine attribute is still pointed at this window.
$in = '<a href="/x" target="_top">go</a>';
$out = $rewrite($in);
$check('attribute _top rewritten to window', str_contains($out, 'target="_netbase_window"') && !str_contains($out, 'target="_top"'));

// 2. Unquoted attribute, and _parent, outside a script.
$check('unquoted target=_top rewritten', str_contains($rewrite('<a target=_top >x</a>'), 'target="_netbase_window"'));
$check('_parent rewritten', str_contains($rewrite('<a target="_parent">x</a>'), 'target="_netbase_window"'));

// 3. BUG2: a script that builds HTML in a JS string must be left byte-for-byte
//    untouched — the target= inside it is not an attribute.
$script = '<script>var s = "<a href=\'/x\' target=\'_top\'>label</a>"; document.write(s);</script>';
$out = $rewrite($script);
$check('script body untouched (identical)', $out === $script);
$check('script not given window name', !str_contains($out, '_netbase_window'));

// 4. Mixed: attribute outside a script rewritten, target inside script preserved.
$mixed = '<a target="_top">real</a>' . $script . '<a target="_blank">also</a>';
$out = $rewrite($mixed);
$check('mixed: outside rewritten', substr_count($out, 'target="_netbase_window"') === 2);
$check('mixed: script preserved', str_contains($out, $script));

// 5. Contrast — the OLD transform corrupts case 3 (proves the bug it fixes):
$oldOut = $oldRewrite($script);
$brokeJs = str_contains($oldOut, 'target="_netbase_window"');   // double-quote injected into the single-quoted JS fragment
$check('OLD transform corrupts the JS string (bug reproduced)', $brokeJs);

echo "\n" . ($fail === 0 ? "ALL PASS" : "$fail FAILED") . "\n";
exit($fail === 0 ? 0 : 1);
