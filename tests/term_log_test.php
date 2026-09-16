<?php
/**
 * Regression test: TermLogService — what a terminal leaves behind.
 *
 * Covers the parts that decide what is kept and in what shape, with no
 * database and no terminal:
 *   - recording is off until it is switched on, and a number left in the box
 *     cannot start it on its own,
 *   - switched on with nothing in the box, it starts at five thousand,
 *   - both limits are held inside sane bounds,
 *   - the colours and cursor moves a terminal threads through its output are
 *     taken out, and the words are left,
 *   - a very long step is shortened from the middle, keeping both ends,
 *   - a session name that is not a session name reaches no directory.
 *
 * Needs the Nextcloud autoloader for OCP\IConfig.
 * Run: php tests/term_log_test.php   (NC_ROOT=/var/www/nextcloud by default)
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Service/TermLogService.php';

use OCA\NetBase\Service\TermLogService;

/** Settings that live only in an array, for the length of the test. */
$config = new class implements \OCP\IConfig {
	public array $user = [];
	public function setSystemValues(array $configs): void {}
	public function setSystemValue($key, $value): void {}
	public function getSystemValue($key, $default = '') { return $default; }
	public function getSystemValueBool(string $key, bool $default = false): bool { return $default; }
	public function getSystemValueInt(string $key, int $default = 0): int { return $default; }
	public function getSystemValueString(string $key, string $default = ''): string { return $default; }
	public function getFilteredSystemValue($key, $default = '') { return $default; }
	public function deleteSystemValue($key): void {}
	public function getAppKeys($appName): array { return []; }
	public function setAppValue($appName, $key, $value): void {}
	public function getAppValue($appName, $key, $default = '') { return $default; }
	public function deleteAppValue($appName, $key): void {}
	public function deleteAppValues($appName): void {}
	public function setUserValue($userId, $appName, $key, $value, $preCondition = null) { $this->user[$key] = (string)$value; }
	public function getUserValue($userId, $appName, $key, $default = '') { return $this->user[$key] ?? $default; }
	public function getUserValueForUsers($appName, $key, $userIds): array { return []; }
	public function getUserKeys($userId, $appName): array { return array_keys($this->user); }
	public function getAllUserValues(?string $userId): array { return []; }
	public function deleteUserValue($userId, $appName, $key): void { unset($this->user[$key]); }
	public function deleteAllUserValues($userId): void { $this->user = []; }
	public function deleteAppFromAllUsers($appName): void {}
	public function getUsersForUserValue($appName, $key, $value): array { return []; }
};

$log = (new ReflectionClass(TermLogService::class))->newInstanceWithoutConstructor();
$prop = new ReflectionProperty(TermLogService::class, 'config');
$prop->setAccessible(true);
$prop->setValue($log, $config);

/** Reach a private method by name. */
$call = static function (string $name, ...$args) use ($log) {
	$m = new ReflectionMethod(TermLogService::class, $name);
	$m->setAccessible(true);
	return $m->invoke($log, ...$args);
};

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  ($got)") . "\n";
	if (!$ok) { $fail++; }
};

// Nothing is recorded until somebody asks for it.
$check('keeps no steps by default', $log->keepSteps('u') === 0, (string)$log->keepSteps('u'));
$check('recording is off by default', $log->enabled('u') === false);

// The number on its own decides nothing: recording is its own switch, so a
// figure left in the box cannot start it by accident.
$config->user['term_log_steps'] = '200';
$check('a number alone does not start it', $log->keepSteps('u') === 0, (string)$log->keepSteps('u'));
$check('a number alone leaves it off', $log->enabled('u') === false);

$config->user['term_log_on'] = '1';
$check('a set number of steps is used', $log->keepSteps('u') === 200, (string)$log->keepSteps('u'));
$check('recording is then on', $log->enabled('u') === true);

// Switched on with nothing in the box: the figure it starts with.
unset($config->user['term_log_steps']);
$check('it starts at five thousand', $log->keepSteps('u') === 5000, (string)$log->keepSteps('u'));

// Both limits stay inside sane bounds whatever is stored.
$config->user['term_log_steps'] = '-5';
$check('a negative step count becomes one', $log->keepSteps('u') === 1, (string)$log->keepSteps('u'));
$config->user['term_log_steps'] = '999999';
$check('an absurd step count is brought down', $log->keepSteps('u') === 10000, (string)$log->keepSteps('u'));

$check('keeps 30 days by default', $log->keepDays('u') === 30, (string)$log->keepDays('u'));
$config->user['term_log_days'] = '0';
$check('zero days becomes one', $log->keepDays('u') === 1, (string)$log->keepDays('u'));
$config->user['term_log_days'] = '99999';
$check('an absurd number of days is brought down', $log->keepDays('u') === 3650, (string)$log->keepDays('u'));

// What a terminal actually sends: words with instructions threaded through.
$raw = "\x1b[0m\x1b[01;34mdocuments\x1b[0m  \x1b[01;32mrun.sh\x1b[0m\r\ntotal 8\r\n";
$clean = $call('clean', $raw, 65536);
$check('colours are taken out', !str_contains($clean, "\x1b"), bin2hex(substr($clean, 0, 12)));
$check('the words are left', str_contains($clean, 'documents') && str_contains($clean, 'run.sh'));
$check('the line endings are plain', !str_contains($clean, "\r"));
$check('nothing else is lost', str_contains($clean, 'total 8'));

// A window title is an instruction too, and no part of it belongs in a log.
$osc = $call('clean', "\x1b]0;root@server: /var\x07ready\n", 65536);
$check('a window title is taken out', trim($osc) === 'ready', trim($osc));

// A step that runs long keeps both ends, not just the front.
$long = str_repeat('A', 400) . 'MIDDLE' . str_repeat('Z', 400);
$short = $call('clean', $long, 200);
$check('a long step is shortened', strlen($short) < strlen($long), (string)strlen($short));
$check('a long step keeps its beginning', str_starts_with($short, 'AAA'));
$check('a long step keeps its end', str_ends_with($short, 'ZZZ'));
$check('a long step says where it was cut', str_contains($short, '…'));

// A session name is a session name, or it reaches nothing.
$check('a path cannot be smuggled in as a session', $call('dir', 'u', '../../etc', false) === '');
$check('a short name is refused', $call('dir', 'u', 'abc', false) === '');
$check('a real session name is accepted', $call('dir', 'u', str_repeat('a1b2', 6), false) !== '');

// ---------------------------------------------------------------------------
// A line and the answer it produced belong together.
//
// This is the part that is easy to get wrong and easy to test wrongly: in a
// real terminal the answer arrives AFTER the Return that asked for it, so a
// step closed on Return would pair every command with the previous command's
// output. Here the keystrokes and the output are fed in the order a real
// terminal produces them, one character at a time, and the pairing is checked.

require_once __DIR__ . '/../lib/Db/TermLogEntity.php';
require_once __DIR__ . '/../lib/Db/TermLogMapper.php';

/** A mapper that keeps the rows in memory instead of a database. */
$mapper = new class extends \OCA\NetBase\Db\TermLogMapper {
	/** @var list<\OCA\NetBase\Db\TermLogEntity> */
	public array $rows = [];
	public function __construct() {}
	public function insert(\OCP\AppFramework\Db\Entity $entity): \OCP\AppFramework\Db\Entity {
		$this->rows[] = $entity;
		return $entity;
	}
	public function trim(string $userId, string $session, int $keep): int {
		$drop = count($this->rows) - $keep;
		if ($drop > 0) { $this->rows = array_slice($this->rows, $drop); }
		return max(0, $drop);
	}
};
$mp = new ReflectionProperty(TermLogService::class, 'mapper');
$mp->setAccessible(true);
$mp->setValue($log, $mapper);

$config->user['term_log_on'] = '1';
$config->user['term_log_steps'] = '10';
$config->user['term_log_days'] = '30';

$uid = 'tester';
$sess = str_repeat('c0ffee', 4);
$log->begin($uid, $sess, 'shell', 'test');
// The shell greets before anything is typed.
$log->said($uid, $sess, "\x1b]0;tester@box\x07tester@box:~$ ");
foreach (['whoami', 'pwd', 'date'] as $i => $cmd) {
	foreach (str_split($cmd) as $ch) { $log->typed($uid, $sess, $ch); }
	$log->typed($uid, $sess, "\r");
	// Only now does the answer come back.
	$log->said($uid, $sess, "answer-for-$cmd\r\ntester@box:~$ ");
}
$log->finish($uid, $sess);

$check('every command becomes a step', count($mapper->rows) === 3, (string)count($mapper->rows));
$paired = 0;
foreach ($mapper->rows as $row) {
	$typed = trim((string)$row->getTyped());
	if ($typed !== '' && str_contains((string)$row->getSaid(), 'answer-for-' . $typed)) { $paired++; }
}
$check('each step holds the answer to its own command', $paired === count($mapper->rows), "$paired/" . count($mapper->rows));
$first = $mapper->rows[0] ?? null;
$check('the greeting stays with the first command', $first !== null && str_contains((string)$first->getSaid(), 'answer-for-whoami'));
$check('the steps are numbered in order', array_map(fn ($r) => $r->getStep(), $mapper->rows) === [1, 2, 3]);

// A command typed but never sent is still kept when the window closes.
$mapper->rows = [];
$sess2 = str_repeat('dec0de', 4);
$log->begin($uid, $sess2, 'shell', 'test');
foreach (str_split('rm -rf /tmp/x') as $ch) { $log->typed($uid, $sess2, $ch); }
$log->finish($uid, $sess2);
$check('an unsent line is still kept', count($mapper->rows) === 1 && str_contains((string)$mapper->rows[0]->getTyped(), 'rm -rf'), (string)count($mapper->rows));

echo $fail === 0 ? "\nall good\n" : "\n$fail failed\n";
exit($fail === 0 ? 0 : 1);
