<?php
/**
 * Regression test (2026-10-06, eiseikosya): an H.VIEW recorder (Uniview firmware)
 * could not be signed in to through the device window. Its sign-in script sends a
 * PUT to /LAPI/V1.0/System/Security/Login, gets a 200 whose JSON says 401 and whose
 * WWW-Authenticate header carries the digest nonce, and works out the digest answer
 * itself from that header. NetBase passed only a fixed list of headers, so the
 * script read null, threw, and the sign-in never happened.
 *
 * The header now passes on any answer but a 401 (on a 401 NetBase asks for the
 * password itself, as before).
 *
 * Run: php tests/www_authenticate_pass_test.php   (needs nothing but PHP)
 */
require __DIR__ . '/../lib/Service/ProxyService.php';

$m = new ReflectionMethod(\OCA\NetBase\Service\ProxyService::class, 'passes');
$m->setAccessible(true);
$passes = static fn (string $name, int $status): bool => $m->invoke(null, $name, $status);

$fail = 0;
$check = static function (string $name, bool $ok) use (&$fail): void {
	echo ($ok ? "PASS" : "FAIL") . "  " . $name . "\n";
	if (!$ok) { $fail++; }
};

$check('a 200 keeps WWW-Authenticate (the recorder reads its nonce from it)', $passes('www-authenticate', 200));
$check('a 401 still drops it (NetBase shows its own password box there)', !$passes('www-authenticate', 401));
$check('content-type still passes', $passes('content-type', 200));
$check('set-cookie still never reaches the browser', !$passes('set-cookie', 200));
$check('x-frame-options is still dropped', !$passes('x-frame-options', 200));

echo $fail ? "$fail FAILED\n" : "all passed\n";
exit($fail ? 1 : 0);
