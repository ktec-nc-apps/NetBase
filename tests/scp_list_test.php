<?php
/**
 * Regression test: ScpSession — reading what `ls` says.
 *
 * SCP has no listing of its own, so a directory is read by running `ls -la`
 * over the shell and taking the reply apart. Two things went wrong there and
 * are pinned down here:
 *
 *   - permissions came out too small, because the letters r, w and x already
 *     carry their own weight and were being shifted by their position as well,
 *     turning 0640 into 0600;
 *   - a file called "report 2026.txt" lost the first word of its name, because
 *     the timestamp was matched by a greedy group that ate it.
 *
 * Neither needs a server, so neither is excused from being tested.
 *
 * Run: php tests/scp_list_test.php
 */
require __DIR__ . '/../lib/Service/ScpSession.php';

use OCA\NetBase\Service\ScpSession;

$session = (new ReflectionClass(ScpSession::class))->newInstanceWithoutConstructor();
// Skipping the constructor leaves every typed property uninitialised, and PHP
// makes reading one a fatal error — rawlist() reaches $sudoPassword on its way
// to run(). The constructor's own default is what a session without elevation
// holds, so that is what is put there.
$sudo = new ReflectionProperty(ScpSession::class, 'sudoPassword');
$sudo->setAccessible(true);
$sudo->setValue($session, '');

/** Reach a private method by name. */
$call = static function (string $name, ...$args) use ($session) {
    $m = new ReflectionMethod(ScpSession::class, $name);
    $m->setAccessible(true);
    return $m->invoke($session, ...$args);
};

/** rawlist() runs a command; here the reply is handed over directly. */
$listOf = static function (string $output) use ($session): array {
    $scp = new class ($output) {
        public function __construct(private string $out) {}
        public function exec(string $command): string { return $this->out; }
    };
    $p = new ReflectionProperty(ScpSession::class, 'scp');
    $p->setAccessible(true);
    $p->setValue($session, $scp);
    $f = new ReflectionProperty(ScpSession::class, 'fetched');
    $f->setAccessible(true);
    $f->setValue($session, []);
    return $session->rawlist('/somewhere') ?: [];
};

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
    echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  ($got)") . "\n";
    if (!$ok) { $fail++; }
};

// ---------------------------------------------------------------- permissions
$cases = [
    '-rw-r-----' => 0100640,
    '-rw-------' => 0100600,
    '-rw-rw-rw-' => 0100666,
    '-rwxr-xr-x' => 0100755,
    '----------' => 0100000,
    'drwxr-xr-x' => 040755,
    'drwx------' => 040700,
    'lrwxrwxrwx' => 0120777,
];
foreach ($cases as $text => $want) {
    $got = $call('modeBits', $text);
    $check("$text reads as " . sprintf('%06o', $want), $got === $want, sprintf('%06o', $got));
}

// ------------------------------------------------------------------- listings
$numeric = implode("\n", [
    'total 88',
    'drwxr-xr-x   3 root root  4096 1789315262 .',
    'drwxrwxrwt 362 root root 73728 1789315262 ..',
    '-rw-r-----   1 root root 12000 1789315262 a.txt',
    'drwxr-xr-x   2 root root  4096 1789315262 dir with space',
    '-rw-r--r--   1 root root    42 1789315262 a b; touch /tmp/pwned',
]);
$list = $listOf($numeric);
$check('the entries are found', count($list) === 3, (string)count($list));
$check('. and .. are left out', !isset($list['.']) && !isset($list['..']));
$check('a plain file is a file', ($list['a.txt']['type'] ?? 0) === 1);
$check('its size survives', ($list['a.txt']['size'] ?? 0) === 12000, (string)($list['a.txt']['size'] ?? 0));
$check('its permissions survive', ($list['a.txt']['permissions'] ?? 0) === 0100640, sprintf('%06o', $list['a.txt']['permissions'] ?? 0));
$check('its timestamp survives', ($list['a.txt']['mtime'] ?? 0) === 1789315262, (string)($list['a.txt']['mtime'] ?? 0));
$check('a directory is a directory', ($list['dir with space']['type'] ?? 0) === 2);
$check('a name with a space is kept whole', isset($list['dir with space']), implode(' | ', array_keys($list)));
$check('a name full of punctuation is kept whole', isset($list['a b; touch /tmp/pwned']), implode(' | ', array_keys($list)));

// The fallback format, for a server whose ls has no --time-style.
$plain = implode("\n", [
    'total 8',
    '-rw-r-----   1 root root 12000 Sep 14 01:01 report 2026.txt',
    'drwxr-xr-x   2 root root  4096 Jan  3  2025 old stuff',
]);
$list = $listOf($plain);
$check('the plain date format is read too', count($list) === 2, (string)count($list));
$check('a name with a year in it stays whole', isset($list['report 2026.txt']), implode(' | ', array_keys($list)));
$check('a date without a time is read too', isset($list['old stuff']), implode(' | ', array_keys($list)));
$check('the plain date becomes a time', ($list['report 2026.txt']['mtime'] ?? 0) > 0);

// SELinux and ACLs add a mark after the letters; it is not part of them.
$marked = "-rw-r-----. 1 root root 5 1789315262 selinux.txt\n-rw-rw----+ 1 root root 5 1789315262 acl.txt";
$list = $listOf($marked);
$check('an SELinux mark does not hide the file', isset($list['selinux.txt']), implode(' | ', array_keys($list)));
$check('an ACL mark does not hide the file', isset($list['acl.txt']), implode(' | ', array_keys($list)));
$check('the marked permissions are still right', ($list['selinux.txt']['permissions'] ?? 0) === 0100640, sprintf('%06o', $list['selinux.txt']['permissions'] ?? 0));

// A symbolic link is written "name -> target".
$link = '-rw-r-----   1 root root 5 1789315262 a.txt' . "\n" . 'lrwxrwxrwx   1 root root 5 1789315262 shortcut -> a.txt';
$list = $listOf($link);
$check('a link keeps its own name', isset($list['shortcut']), implode(' | ', array_keys($list)));

echo $fail === 0 ? "\nall good\n" : "\n$fail failed\n";
exit($fail === 0 ? 0 : 1);
