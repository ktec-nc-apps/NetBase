<?php
/**
 * Regression test: ShellGateService — the gate in front of the local shell.
 *
 * Covers the parts that decide whether a shell may open, using a fake session
 * so nothing depends on the network or a mail server:
 *   - a correct code opens the gate (issues a ticket) and is then spent,
 *   - a wrong code is refused and the remaining attempts count down,
 *   - the code is thrown away after too many wrong guesses,
 *   - an expired code is refused,
 *   - the emailed address is masked, never returned whole.
 *
 * Needs the Nextcloud autoloader for OCP\ISession.
 * Run: php tests/shell_gate_test.php   (NC_ROOT=/var/www/nextcloud by default)
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Service/ShellGateService.php';

use OCA\NetBase\Service\ShellGateService;

/** A session that lives only in an array, for the length of the test. */
$session = new class implements \OCP\ISession {
	public array $store = [];
	public function set(string $key, $value): void { $this->store[$key] = $value; }
	public function get(string $key) { return $this->store[$key] ?? null; }
	public function exists(string $key): bool { return isset($this->store[$key]); }
	public function remove(string $key): void { unset($this->store[$key]); }
	public function clear(): void { $this->store = []; }
	public function reopen(): bool { return false; }
	public function close(): void {}
	public function regenerateId(bool $deleteOldSession = true, bool $updateToken = false): void {}
	public function getId(): string { return 'test'; }
};

$gate = (new ReflectionClass(ShellGateService::class))->newInstanceWithoutConstructor();
$prop = new ReflectionProperty(ShellGateService::class, 'session');
$prop->setAccessible(true);
$prop->setValue($gate, $session);

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  ($got)") . "\n";
	if (!$ok) { $fail++; }
};

// Plant a known code, the way begin() would.
$plant = static function (string $code, int $ttl = 600) use ($session): void {
	$session->store = [
		'netbase_shell_code' => hash('sha256', $code),
		'netbase_shell_expires' => time() + $ttl,
		'netbase_shell_attempts' => 0,
	];
	$session->remove('netbase_shell_ticket');
};

$hasTicket = static fn (): bool => $gate->hasTicket();

// A correct code opens the gate and is then gone.
$plant('123456');
$r = $gate->verify('123456');
$check('correct code verifies', $r['ok'] === true);
$check('correct code issues a ticket', $hasTicket());
$check('correct code is spent (no code left)', !isset($session->store['netbase_shell_code']));
$r = $gate->verify('123456');
$check('the same code cannot be reused', $r['ok'] === false && $r['error'] === 'expired');

// A wrong code is refused and counts down.
$session->remove('netbase_shell_ticket');
$plant('654321');
$r = $gate->verify('000000');
$check('wrong code is refused', $r['ok'] === false && $r['error'] === 'wrong');
$check('wrong code reports remaining tries', ($r['remaining'] ?? -1) === 4);
$check('wrong code issues no ticket', !$hasTicket());
$check('wrong code keeps the code alive', isset($session->store['netbase_shell_code']));

// Too many wrong guesses throw the code away.
$plant('222333');
for ($i = 0; $i < 4; $i++) { $gate->verify('111111'); }
$r = $gate->verify('111111');
$check('code is dropped after too many wrong guesses', $r['ok'] === false && $r['error'] === 'too-many');
$check('the right code no longer works once dropped', $gate->verify('222333')['ok'] === false);

// An expired code is refused even when correct.
$plant('444555', -1);
$r = $gate->verify('444555');
$check('expired code is refused', $r['ok'] === false && $r['error'] === 'expired');

// The address is masked.
$mask = new ReflectionMethod(ShellGateService::class, 'mask');
$mask->setAccessible(true);
$m = $mask->invoke($gate, 'admin@example.com');
$check('mask hides the local part', $m === 'a****@example.com', $m);
$check('mask keeps the domain', str_ends_with($m, '@example.com'));

// The closed-network check must not rest on a single kind of probe: a site
// that blocks one of them must not be mistaken for a closed network, since
// that is the misreading which would open a shell without a code.
$src = (string)file_get_contents(__DIR__ . '/../lib/Service/ShellGateService.php');
$check('reachability is tried over TCP', str_contains($src, 'REACH_TCP'));
$check('reachability is tried over DNS', str_contains($src, 'REACH_DNS'));
$check('reachability is tried over NTP', str_contains($src, 'REACH_NTP'));
$at = strpos($src, 'public function isClosedNetwork');
$body = $at !== false ? substr($src, $at, 2500) : '';
$check('any single answer means a code is required', substr_count($body, 'return false;') >= 3);
$check('the addresses are IPs, not names', preg_match('/REACH_NTP = \[\'\d+\.\d+\.\d+\.\d+\'/', $src) === 1);

$lint = shell_exec('php -l ' . escapeshellarg(__DIR__ . '/../lib/Service/ShellGateService.php') . ' 2>&1');
$check('ShellGateService lints clean', strpos((string)$lint, 'No syntax errors') !== false);

echo $fail === 0 ? "\nALL PASS\n" : "\n$fail FAILED\n";
exit($fail === 0 ? 0 : 1);
