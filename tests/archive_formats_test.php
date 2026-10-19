<?php
/**
 * Regression test: the archive formats file transfer makes and opens
 * (ArchiveFormats), asked for on 2026-10-18 ("ファイル圧縮形式の対応範囲を広げてくれ").
 *
 * Besides the names and the tool rules, every format whose tools this machine
 * has is really made and opened with the command lines built here, in a
 * scratch folder, and the files that come out are compared with the files that
 * went in — names with spaces, a leading dash and Japanese included.
 *
 * Run: php tests/archive_formats_test.php
 */
require __DIR__ . '/../lib/Service/ArchiveFormats.php';
use OCA\NetBase\Service\ArchiveFormats as A;

$fail = 0;
$ok = function (bool $c, string $m) use (&$fail): void { echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) { $fail++; } };

foreach (['site.tar.gz' => 'tgz', 'a.TGZ' => 'tgz', 'b.tar.bz2' => 'tbz2', 'c.tbz' => 'tbz2', 'd.tar.xz' => 'txz', 'e.tar.zst' => 'tzst',
	'f.tar' => 'tar', 'g.zip' => 'zip', 'h.7z' => '7z', 'i.rar' => 'rar', 'log.gz' => 'gz', 'j.bz2' => 'bz2', 'k.xz' => 'xz', 'l.zst' => 'zst',
	'notes.txt' => null, '.gz' => null, 'archive' => null] as $name => $want) {
	$ok(A::detect($name) === $want, $name . ' is ' . var_export($want, true));
}
$ok(A::stem('site.tar.gz') === 'site' && A::stem('log.gz') === 'log' && A::stem('photos.ZIP') === 'photos', 'the name without its extension');
$ok(A::parseProbe("tar\ngzip\n7zz\ntar-zstd\nnonsense\n") === ['tar', 'gzip', '7zz', 'tar-zstd', '7z'], 'a probe answer is read, and 7zz counts as 7z');
$av = A::availability(['tar', 'gzip']);
$ok($av['tgz']['make'] && $av['tgz']['open'] && !$av['txz']['make'] && !$av['7z']['open'], 'with tar and gzip: tar.gz yes, tar.xz and 7z no');
$ok(!$av['rar']['make'], 'RAR is never made (no free tool makes it)');
$ok(A::makeCommand('gz', ['a', 'b'], ['gzip']) === null, 'gzip compresses one file, not two');
$ok(A::makeCommand('txz', ['a'], ['tar']) === null && A::openCommand('7z', '/x.7z', '/d', ['tar']) === null, 'a missing tool gives no command');
$ok(str_contains((string)A::makeCommand('tar', ['-rf', 'x y'], ['tar']), "'./-rf' './x y'"), 'names are quoted and cannot pass for options');

// --- real round trips with the tools this machine has
$have = A::parseProbe((string)shell_exec(A::probeCommand()));
echo '     tools here: ' . implode(' ', $have) . "\n";
$base = sys_get_temp_dir() . '/nb-archive-test-' . bin2hex(random_bytes(4));
mkdir($base . '/src/sub dir', 0777, true);
file_put_contents($base . '/src/a.txt', "one\n");
file_put_contents($base . '/src/-dash.txt', "two\n");
file_put_contents($base . '/src/sub dir/日本語.txt', "三\n");
$sh = function (string $cmd, string $cwd): array { $out = []; $rc = 0; exec('cd ' . escapeshellarg($cwd) . ' && { ' . $cmd . '; } 2>&1', $out, $rc); return [$rc === 0, implode("\n", $out)]; };
$tree = function (string $dir): array { $r = []; $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)); foreach ($it as $f) { $r[substr($f->getPathname(), strlen($dir) + 1)] = file_get_contents($f->getPathname()); } ksort($r); return $r; };
$want = $tree($base . '/src');
foreach (A::FORMATS as $id => $f) {
	$names = $f['single'] ? ['a.txt'] : ['a.txt', '-dash.txt', 'sub dir'];
	$make = A::makeCommand($id, $names, $have);
	if ($make === null) { echo "     skip $id (no tool here)\n"; continue; }
	$out = $base . '/out-' . $id . $f['ext'];
	[$okMake, $msg] = $sh('o=' . escapeshellarg($out) . '; ' . $make, $base . '/src');
	$ok($okMake && is_file($out) && filesize($out) > 0, "$id: made" . ($okMake ? '' : ': ' . $msg));
	$into = $f['single'] ? $base . '/back-' . $id . '.txt' : $base . '/back-' . $id;
	if (!$f['single']) { mkdir($into); }
	$open = A::openCommand($id, $out, $into, $have);
	if ($open === null) { echo "     skip opening $id\n"; continue; }
	[$okOpen, $msg] = $sh($open, $base);
	$got = $f['single'] ? ['a.txt' => (string)@file_get_contents($into)] : $tree($into);
	$ok($okOpen && $got === ($f['single'] ? ['a.txt' => "one\n"] : $want), "$id: opened, and the same files came out" . ($okOpen ? '' : ': ' . $msg));
}
// the second-choice tools: zstd through a pipe when tar lacks --zstd; zip by python3, or by 7-Zip
foreach ([['tzst', array_values(array_diff($have, ['tar-zstd']))], ['zip', array_values(array_diff($have, ['zip', '7z', 'unzip', 'bsdtar']))], ['zip', array_values(array_diff($have, ['zip', 'unzip', 'python3', 'bsdtar']))]] as $k => [$id, $tools]) {
	$make = A::makeCommand($id, ['a.txt', 'sub dir'], $tools);
	$open = A::openCommand($id, $base . "/alt$k" . A::FORMATS[$id]['ext'], $base . "/alt$k", $tools);
	if ($make === null || $open === null) { echo "     skip alternative $k\n"; continue; }
	[$m1] = $sh('o=' . escapeshellarg($base . "/alt$k" . A::FORMATS[$id]['ext']) . '; ' . $make, $base . '/src');
	mkdir($base . "/alt$k");
	[$m2, $msg] = $sh($open, $base);
	$got = $tree($base . "/alt$k");
	$ok($m1 && $m2 && $got === array_intersect_key($want, $got) && count($got) === 2, "$id with " . implode(',', array_intersect($tools, ['zstd', 'python3', '7z'])) . ' only: made and opened');
}
// a failing tar inside the zstd pipe is not hidden by the pipe
[$m] = $sh('o=' . escapeshellarg($base . '/bad.tar.zst') . '; ' . A::makeCommand('tzst', ['no-such-file'], ['tar', 'zstd']), $base . '/src');
$ok(!$m, 'a tar that fails inside the zstd pipe fails the whole command');
exec('rm -rf ' . escapeshellarg($base));
echo $fail ? "$fail FAILED\n" : "ALL OK\n";
exit($fail ? 1 : 0);
