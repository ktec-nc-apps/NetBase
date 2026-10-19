<?php
/**
 * Regression test: the tar reader file transfer uses where the far end has no
 * shell (TransferService::untar), on archives made to be awkward: names that
 * climb out ("../"), a symbolic link to /etc/passwd, long names written the
 * pax way and the GNU way, names starting "./" (which PharData could not list
 * at all, the reason this reader exists), a Japanese name, and a file that is
 * not a tar.
 *
 * Run: php tests/untar_test.php
 */
require __DIR__ . '/../lib/Service/ArchiveFormats.php';
require __DIR__ . '/../lib/Service/L10nService.php';
require __DIR__ . '/../lib/Service/TransferService.php';
foreach (['OCP\\Files\\Folder', 'OCP\\Files\\File', 'OCP\\Files\\IRootFolder', 'Psr\\Log\\LoggerInterface'] as $i) {
    if (!interface_exists($i)) { eval('namespace ' . substr($i, 0, strrpos($i, '\\')) . '; interface ' . substr($i, strrpos($i, '\\') + 1) . ' {}'); }
}
if (!interface_exists('OCP\\IL10N')) { eval('namespace OCP; interface IL10N {}'); }
use OCA\NetBase\Service\{TransferService, L10nService};
const TRICKY = 'H4sICDLU1GoC/3RyaWNreS50YXIA7djBSsMwHAbwnH2KvsCSJmnXXaQePfoK0XY6Nruydthru0dQ8SKCoBfnG/g4geFjmCmIdEKVmQrr94PS0EsPf758aSmbjmle5MQi1+h73vvdqN8N/8t6/TwQXkAcl7RgnuVqZl5Jumk4SuI9Al1FKZunljeA5vx79fxLify34lhFiH+HTUbJ2PY7mvNfW3O3H3DiCBbnJyxVWXYRIf+W9n9G2cGRKg5jFcUze/P/Zu6fMxeBV5+/EC5xCuz/1vHBwElVfrZPWbQFFm+BTabJaS9R53Fv+EPrEwt660/yb3/sv/7+k5z3cf5rp/9N9BCkLuf///vf9eRG/3OB/m+D9D/qf3XzuLp9fn26Y3pxrat7XT3oxRI1u+vCMGTmCm3+Amrsf77x/9eXHP3fBl0udfmiq0tdXiHpAAAAAAAAALvpDSYmviQAKAAA';
const GNU = 'H4sIAEbU1GoC/+3TMQrDMAxAUc09hU9gy42x1x7Al8hkSsGBxIEeP5RAIUPGNJT8t0hoFd866x55qCU/60uOoau9qT6l777eU4p3MVl+YJ5aPxojF2VdOYlt7ya4wP8/UccQdvtXDdv+Ox99EKP0f7hS5xsVAAAAAAAAAAAAAAAA/K8FS/+elgAoAAA=';
$l = new class extends L10nService { public function __construct() {} public function t(string $text, array $p = []): string { return vsprintf($text, $p); } };
$ts = (new ReflectionClass(TransferService::class))->newInstanceWithoutConstructor();
(new ReflectionProperty(TransferService::class, 'l'))->setValue($ts, $l);
$x = new ReflectionMethod(TransferService::class, 'extractHere');
$fail = 0; function ok($c, $m) { global $fail; echo ($c ? "ok   " : "FAIL ") . $m . "\n"; if (!$c) $fail++; }
$base = sys_get_temp_dir() . '/nbtar-' . getmypid(); @mkdir($base); @mkdir("$base/in"); @mkdir("$base/x");
file_put_contents("$base/in/t.tar.gz", base64_decode(TRICKY));
$x->invoke($ts, "$base/in/t.tar.gz", 'tgz', "$base/x");
$files = []; foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator("$base/x", FilesystemIterator::SKIP_DOTS)) as $f) { $files[] = substr($f->getPathname(), strlen("$base/x/")); }
sort($files);
ok(in_array('ok.txt', $files, true) && file_get_contents("$base/x/ok.txt") === "fine\n", 'a "./" name is read (GNU tar makes these)');
ok(!file_exists("$base/up.txt") && !in_array('up.txt', $files, true), '"../up.txt" is passed over');
ok(!file_exists("$base/x/link") && !is_link("$base/x/link"), 'a symbolic link is not made');
ok(count(array_filter($files, fn ($f) => str_contains($f, 'long-name-'))) === 1, 'a pax long name (over 100 characters) comes out whole');
ok(file_exists("$base/x/日本語/ファイル.txt") && file_get_contents("$base/x/日本語/ファイル.txt") === "にほんご\n", 'a Japanese name');
@mkdir("$base/y"); file_put_contents("$base/in/g.tar", gzdecode(base64_decode(GNU)));
$x->invoke($ts, "$base/in/g.tar", 'tar', "$base/y");
ok(file_exists("$base/y/" . str_repeat('g', 120) . '.txt'), 'a GNU long name');
@mkdir("$base/z"); file_put_contents("$base/in/b.tar", str_repeat('not a tar at all', 64));
try { $x->invoke($ts, "$base/in/b.tar", 'tar', "$base/z"); ok(false, 'a damaged tar should stop'); } catch (RuntimeException $e) { ok(str_contains($e->getMessage(), 'damaged'), 'a file that is not a tar stops with a reason'); }
exec('rm -rf ' . escapeshellarg($base));
echo $fail ? "$fail FAILED\n" : "ALL OK\n";
