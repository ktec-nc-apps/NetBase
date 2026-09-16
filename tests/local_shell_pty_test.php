<?php
/**
 * Regression test: PtyService::serveLocal() opens a real shell on THIS server.
 *
 * It runs the actual service (not a stand-in): a session directory is staged
 * with a couple of queued commands, serveLocal() spawns the Python pty bridge,
 * feeds them in, and everything the shell draws is collected. The test proves
 *   - a login shell really starts and runs commands,
 *   - it runs as the account Nextcloud runs as (www-data here), with no rise
 *     in privilege,
 *   - the window size handed in reaches the shell (tput cols echoes it back).
 *
 * Because PHP-FPM is not involved, the shell runs as whoever runs the test —
 * so run it as www-data to check the real case:
 *   sudo -u www-data php tests/local_shell_pty_test.php
 *
 * Needs the Nextcloud autoloader for Psr\Log\NullLogger.
 * Run with NC_ROOT=/var/www/nextcloud (default).
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/3rdparty/autoload.php';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Service/PtyService.php';

use OCA\NetBase\Service\PtyService;

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  ($got)") . "\n";
	if (!$ok) { $fail++; }
};

$pty = (new ReflectionClass(PtyService::class))->newInstanceWithoutConstructor();
$log = new ReflectionProperty(PtyService::class, 'logger');
$log->setAccessible(true);
$log->setValue($pty, new class extends \Psr\Log\AbstractLogger {
	public function log($level, $message, array $context = []): void {}
});

if (!$pty->localShellAvailable()) {
	echo "SKIP  a local shell is not available on this server (needs proc_open + python3)\n";
	exit(0);
}

$userId = 'test-user';
$session = bin2hex(random_bytes(16));
$cols = 133;

// Stage the session directory the way the streaming request would, and queue
// the keystrokes so the very first read has them. A trailing `exit` lets the
// shell end on its own, which ends serveLocal().
$base = sys_get_temp_dir() . '/netbase-terminals';
@mkdir($base, 0700, true);
$dir = $base . '/' . hash('sha256', $userId . "\0" . $session);
@mkdir($dir, 0700, true);
file_put_contents($dir . '/in', "id -un; echo COLS=\$(tput cols); echo NBDONE\nexit\n");

$collected = '';
$emit = static function (string $chunk) use (&$collected): bool {
	$collected .= $chunk;
	return true; // never "hang up"
};

$start = microtime(true);
$pty->serveLocal($userId, $session, $cols, 40, $emit);
$elapsed = microtime(true) - $start;

$clean = preg_replace('/\x1b\[[0-9;?]*[a-zA-Z]/', '', $collected) ?? $collected;
$whoami = trim((string)shell_exec('id -un'));

$check('the shell started and ran to the sentinel', str_contains($clean, 'NBDONE'), substr($clean, -80));
$check('the shell runs as this account (' . $whoami . ')', str_contains($clean, $whoami));
$check('the window size reached the shell', str_contains($clean, 'COLS=' . $cols), 'expected COLS=' . $cols);
$check('the session ended promptly on exit (< 20s)', $elapsed < 20.0, sprintf('%.1fs', $elapsed));
$check('the session directory was cleaned up', !is_dir($dir));

// The helper file must ship and parse.
$bridge = realpath(__DIR__ . '/../resources/pty-bridge.py');
$check('pty-bridge.py ships with the app', $bridge !== false && is_file($bridge));
if ($bridge) {
	$py = trim((string)shell_exec('command -v python3'));
	if ($py !== '') {
		$lint = shell_exec(escapeshellarg($py) . ' -c ' . escapeshellarg('import ast,sys; ast.parse(open(sys.argv[1]).read())') . ' ' . escapeshellarg($bridge) . ' 2>&1');
		$check('pty-bridge.py parses', trim((string)$lint) === '');
	}
}

echo $fail === 0 ? "\nALL PASS\n" : "\n$fail FAILED\n";
exit($fail === 0 ? 0 : 1);
