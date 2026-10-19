<?php
/**
 * Regression test: an address is put under the proxy once, never twice, and
 * a climb ("../") from a page that is a directory lands where the device
 * would put it (ProxyService::resolveAgainst, and the fix()/fixMarkup() of the
 * script injected into every device page).
 *
 * Found on a customer's BUFFALO LinkStation (2026-10-19): its page writes
 *   document.write("<script src='../index.js'></script>")
 * The server rewrites that string on the way out to
 *   src='/apps/netbase/proxy/<ticket>/index.js'
 * and the document.write hook then put the prefix in front of it again, so the
 * NAS was asked for /apps/netbase/proxy/<ticket>/apps/netbase/proxy/<ticket>/index.js.
 * And "../x" from "/a/b/" went to "/x" instead of "/a/x", on both sides.
 *
 * The JavaScript is taken out of ProxyService.php and run under node.
 *
 * Run: php tests/proxy_markup_test.php
 */
namespace OCP { if (!interface_exists(IL10N::class)) { interface IL10N {} } }
namespace {
$fail = 0;
$ok = function (bool $c, string $m) use (&$fail): void { echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) { $fail++; } };
$src = file_get_contents(__DIR__ . '/../lib/Service/ProxyService.php');

// --- the server side, by reflection on resolveAgainst
$cut = function (string $from) use ($src): string {
	$pos = strpos($src, $from);
	if ($pos === false) { fwrite(STDERR, "$from not found\n"); exit(2); }
	$brace = strpos($src, '{', $pos);
	for ($i = $brace, $d = 0, $n = strlen($src); $i < $n; $i++) {
		if ($src[$i] === '{') { $d++; } elseif ($src[$i] === '}' && --$d === 0) { break; }
	}
	return substr($src, $pos, $i - $pos + 1);
};
eval('final class R { public ' . substr($cut('private function resolveAgainst('), strlen('private ')) . ' }');
$r = new R();
foreach ([['/rtknas4.40/', '../index.js?_dc=1', '/index.js?_dc=1'], ['/a/b/', '../x.js', '/a/x.js'], ['/a/b/c.html', '../x.js', '/a/x.js'],
	['/', '../x', '/x'], ['/login.html', '../script/a.js', '/script/a.js'], ['/a/b/c/', '../../d/e.png', '/a/d/e.png']] as [$path, $url, $want]) {
	$got = $r->resolveAgainst($path, $url);
	$ok($got === $want, "server: $url from $path is $want (got $got)");
}

// --- the browser side: fix() and fixMarkup() under node
$js = function (string $name) use ($src): string {
	$pos = strpos($src, "\tfunction $name(");
	if ($pos === false) { fwrite(STDERR, "js $name not found\n"); exit(2); }
	$brace = strpos($src, '{', $pos);
	for ($i = $brace, $d = 0, $n = strlen($src); $i < $n; $i++) {
		if ($src[$i] === '{') { $d++; } elseif ($src[$i] === '}' && --$d === 0) { break; }
	}
	return substr($src, $pos, $i - $pos + 1);
};
$harness = 'var P = "/apps/netbase/proxy/TOK"; var PROXY_ROOT = "/apps/netbase/proxy/";'
	. 'var location = { origin: "https://nc.example", host: "nc.example" }; var window = { __nbPath: function () { return PATH; } }; var PATH = "/rtknas4.40/";'
	. $js('fixCss') . "\n" . $js('fix') . "\n" . $js('fixMarkup') . "\n"
	. 'var out = {};'
	. 'out.already = fixMarkup("<script src=\'/apps/netbase/proxy/TOK/index.js?_dc=1\'></scr" + "ipt>");'
	. 'out.climb = fixMarkup("<script src=\'../index.js?_dc=1\'></scr" + "ipt>");'
	. 'out.twice = fixMarkup(fixMarkup("<img src=\'/img/a.png\'><a href=\'/b.html\'>"));'
	. 'out.once = fixMarkup("<img src=\'/img/a.png\'>");'
	. 'out.other = fixMarkup("<script src=\'/apps/netbase/proxy/OTHER/x.js\'></scr" + "ipt>");'
	. 'PATH = "/a/b/"; out.dirclimb = fix("../x.js");'
	. 'console.log(JSON.stringify(out));';
$file = tempnam(sys_get_temp_dir(), 'nbjs') . '.js';
file_put_contents($file, $harness);
$o = json_decode((string)shell_exec('node ' . escapeshellarg($file) . ' 2>&1'), true);
@unlink($file);
if (!is_array($o)) { fwrite(STDERR, "node did not run the harness\n"); exit(2); }
$ok($o['already'] === "<script src='/apps/netbase/proxy/TOK/index.js?_dc=1'></script>", 'an address already under the proxy is left as it is (the NAS case)');
$ok($o['climb'] === "<script src='/apps/netbase/proxy/TOK/index.js?_dc=1'></script>", 'a climb written by script is resolved once');
$ok($o['twice'] === "<img src='/apps/netbase/proxy/TOK/img/a.png'><a href='/apps/netbase/proxy/TOK/b.html'>", 'fixing twice is the same as fixing once');
$ok($o['once'] === "<img src='/apps/netbase/proxy/TOK/img/a.png'>", 'an absolute path gets the prefix');
$ok($o['other'] === "<script src='/apps/netbase/proxy/OTHER/x.js'></script>", 'another ticket\'s address is not prefixed either');
$ok($o['dirclimb'] === '/apps/netbase/proxy/TOK/a/x.js', 'browser: ../x.js from /a/b/ is /a/x.js (got ' . $o['dirclimb'] . ')');
// A compressed body is unpacked before it is passed on without its Content-Encoding (a Check Point
// appliance's init.js.gz reached the browser packed: "SyntaxError: Invalid or unexpected token").
$ok(preg_match("/CURLOPT_ENCODING\s*=>\s*''/", $src) === 1 && str_contains($src, "'content-encoding'"), 'the proxy unpacks what it drops the Content-Encoding of');
// A sibling ticket (the device sent the window to https on another port) is inside the proxy, not an escape.
$app = file_get_contents(__DIR__ . '/../js/netbase.js');
$ok(str_contains($app, "const root = prefix.slice(0, prefix.indexOf('/proxy/') + 7);") && str_contains($app, 'here.indexOf(root) === 0'), 'a page under another ticket of the proxy is not taken for an escape');
echo $fail ? "$fail FAILED\n" : "ALL OK\n";
exit($fail ? 1 : 0);
}
