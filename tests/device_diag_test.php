<?php
/**
 * A device window's diagnosis is meant to be pasted where anyone can read it,
 * so what it keeps of an address must be safe: the names in a query stay and
 * the values go, a session hidden in a path goes, ordinary file names stay —
 * and a recording keeps its order, its limit and nothing once stopped.
 *
 * Run: php tests/device_diag_test.php
 */
// Its own temporary folder, never the one the live proxy uses (run as root,
// the test would otherwise leave files there that the web server cannot touch).
$tmp = rtrim((string)(getenv('TMPDIR') ?: '/tmp'), '/') . '/netbase-diag-test-' . getmypid();
@mkdir($tmp, 0700, true);
putenv('TMPDIR=' . $tmp);
register_shutdown_function(static function () use ($tmp): void {
	foreach (glob($tmp . '/netbase-proxy/*') ?: [] as $f) { @unlink($f); }
	@rmdir($tmp . '/netbase-proxy');
	@rmdir($tmp);
});
require __DIR__ . '/../lib/Service/DeviceDiagService.php';

use OCA\NetBase\Service\DeviceDiagService;

$fail = 0;
$check = static function (string $what, $got, $want) use (&$fail): void {
	if ($got !== $want) {
		$fail++;
		echo "FAIL $what: got " . var_export($got, true) . ', want ' . var_export($want, true) . "\n";
	}
};

// Values after "?" never survive; the names do.
$check('query values', DeviceDiagService::path('/login.cgi', 'user=admin&pwd=secret&lang=en'), '/login.cgi?user=*&pwd=*&lang=*');
$check('name without value', DeviceDiagService::path('/x.htm', 'debug&id=7'), '/x.htm?debug&id=*');
$check('no query', DeviceDiagService::path('index.html'), '/index.html');
// A session token in the path (OpenWrt LuCI) goes; the rest of the path stays.
$check('luci stok', DeviceDiagService::path('/cgi-bin/luci/;stok=4f2a9c1e8b7d6a5f3e2d1c0b/admin/status'), '/cgi-bin/luci/;stok=…/admin/status');
$check('session segment', DeviceDiagService::path('/s/9f8e7d6c5b4a39281706/home.html'), '/s/…/home.html');
// Ordinary long file names are not mistaken for sessions.
$check('long file name', DeviceDiagService::path('/js/jquery-3.6.0.min.js'), '/js/jquery-3.6.0.min.js');
$check('words only', DeviceDiagService::path('/advanced_settings_wireless'), '/advanced_settings_wireless');
// A redirect: on the same device, its address with the values hidden; elsewhere, where it goes.
$check('same device', DeviceDiagService::location('https://192.168.1.1/login.htm?sid=abc', 'http://192.168.1.1'), 'https://192.168.1.1/login.htm?sid=*');
$check('relative', DeviceDiagService::location('/start.htm?t=1', 'http://192.168.1.1'), '/start.htm?t=*');
$check('another host', DeviceDiagService::location('http://192.168.1.2:8080/', 'http://192.168.1.1'), 'http://192.168.1.2:8080/');

// A recording: off until started, kept in order, gone once stopped.
$diag = new DeviceDiagService();
$user = 'diag-test-' . getmypid();
$base = 'http://192.0.2.10';
$check('off before start', $diag->active($user, $base), false);
$diag->record($user, $base, ['p' => '/ignored']);
$diag->start($user, $base);
$check('on after start', $diag->active($user, $base), true);
// The same device on another scheme or port is the same recording.
$check('same host, https', $diag->active($user, 'https://192.0.2.10:8443'), true);
$check('another device', $diag->active($user, 'http://192.0.2.11'), false);
$check('another person', $diag->active($user . 'x', $base), false);
$diag->record($user, $base, ['p' => '/a']);
$diag->record($user, 'https://192.0.2.10', ['p' => '/b']);
for ($i = 0; $i < DeviceDiagService::MAX_ENTRIES + 5; $i++) {
	$diag->record($user, $base, ['p' => '/many']);
}
$got = $diag->stop($user, $base);
$check('kept in order', array_column(array_slice($got['entries'] ?? [], 0, 2), 'p'), ['/a', '/b']);
$check('capped', count($got['entries'] ?? []), DeviceDiagService::MAX_ENTRIES);
$check('timed', isset($got['entries'][0]['t']), true);
$check('off after stop', $diag->active($user, $base), false);
$check('nothing left', $diag->stop($user, $base), null);

echo $fail === 0 ? "device_diag_test: all passed\n" : "device_diag_test: $fail failed\n";
exit($fail === 0 ? 0 : 1);
