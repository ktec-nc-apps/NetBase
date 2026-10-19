<?php
/**
 * Regression test: ScpSession acting as another account through sudo.
 *
 * Three answers sudo can give, each of which went wrong before:
 *
 *   - no prompt at all (NOPASSWD, or signed in as root): the reply arrived
 *     before any prompt, the password was then written into a closed channel,
 *     the reply was lost, and every folder showed as empty after a 10 s wait;
 *   - a prompt, then the command's output: the ordinary case;
 *   - a prompt, then a second prompt: the password was refused, and the
 *     command must be broken off rather than left waiting for another try.
 *
 * It also pins the command: sudo -u <account>, the command in a shell of its
 * own, and the account name refused when it could be read as an option.
 *
 * No server is needed: a fake connection plays sudo's part.
 *
 * Run: php tests/scp_sudo_test.php
 */
require __DIR__ . '/../lib/Service/ScpSession.php';

use OCA\NetBase\Service\ScpSession;

/** Plays a server: what exec was asked, and what read hands back in turn. */
class FakeSudo {
	public array $execs = [];
	public array $writes = [];
	public function __construct(private array $reads) {
	}
	public function enablePTY(): void {
	}
	public function disablePTY(): void {
	}
	public function exec(string $c) {
		$this->execs[] = $c;
		return '';
	}
	public function read($expect = '') {
		return array_shift($this->reads) ?? '';
	}
	public function write(string $s): void {
		$this->writes[] = $s;
	}
}

$fail = 0;
$check = static function (bool $ok, string $what) use (&$fail): void {
	echo ($ok ? 'ok   ' : 'FAIL ') . $what . "\n";
	if (!$ok) {
		$fail++;
	}
};
$prompt = 'netbase-sudo-password:';
/** run() through reflection, so the test reads the same against older code where it was private. */
$run = static function (ScpSession $session, string $command): string {
	$m = new ReflectionMethod(ScpSession::class, 'run');
	$m->setAccessible(true);
	return $m->invoke($session, $command);
};

// NOPASSWD: the output comes straight away, and no password is written.
$fake = new FakeSudo(["hello\r\n"]);
$out = $run(new ScpSession($fake, '', 'root'), 'echo hello');
$check($out === "hello\n", 'no prompt: the reply is kept');
$check($fake->writes === [], 'no prompt: nothing is written');
$check(str_contains($fake->execs[0], "-u 'root' -- sh -c 'echo hello'"), 'the command goes through sudo -u <account> -- sh -c');

// A prompt, then the output.
$fake = new FakeSudo([$prompt, "\r\nfile-a\r\nfile-b\r\n"]);
$out = $run(new ScpSession($fake, 'pw', 'www-data'), 'ls');
$check($out === "file-a\nfile-b\n", 'prompt: output after the password, line endings plain');
$check($fake->writes === ["pw\n"], 'prompt: the password is written once');
$check(str_contains($fake->execs[0], "-u 'www-data'"), 'another account is named to sudo');

// A second prompt: refused, and broken off.
$fake = new FakeSudo([$prompt, "\r\nSorry, try again.\r\n" . $prompt, '']);
try {
	$run(new ScpSession($fake, 'wrong', 'root'), 'ls');
	$check(false, 'wrong password: refused');
} catch (RuntimeException $e) {
	$check(str_contains($e->getMessage(), 'not accepted'), 'wrong password: refused');
	$check(end($fake->writes) === "\x03", 'wrong password: sudo is interrupted');
}

// A prompt with no password to give.
$fake = new FakeSudo([$prompt, '']);
try {
	$run(new ScpSession($fake, '', 'root'), 'ls');
	$check(false, 'no password where one is asked: refused');
} catch (RuntimeException $e) {
	$check(str_contains($e->getMessage(), 'asks for the sudo password') && $fake->writes === ["\x03"], 'no password where one is asked: refused, nothing sent but an interrupt');
}

// The old call — a password and no account — still means root.
$fake = new FakeSudo(['ok']);
$session = new ScpSession($fake, 'pw');
$check($session->actingAs() === 'root', 'a password alone acts as root');

// An account name that could be read as an option is refused.
foreach (['-u root', '', 'a b', 'x;id'] as $bad) {
	if ($bad === '') {
		$check(!(new ScpSession(new FakeSudo([])))->elevated(), 'no account and no password: not elevated');
		continue;
	}
	try {
		new ScpSession(new FakeSudo([]), 'pw', $bad);
		$check(false, "refused: '$bad'");
	} catch (InvalidArgumentException $e) {
		$check(true, "refused: '$bad'");
	}
}

echo $fail ? "$fail FAILED\n" : "all good\n";
exit($fail ? 1 : 0);
