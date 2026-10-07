<?php
/**
 * Regression test (2026-10-06, eiseikosya): an H.VIEW recorder still could not be
 * signed in to after its WWW-Authenticate header was let through. The recorder
 * answers its sign-in with a 200 that carries the header; PHP turns a response
 * into a 401 the moment such a header is set, and NetBase set the status first,
 * so the browser got a 401, put up its own password box, and the sign-in stopped.
 *
 * Each case runs in a PHP process of its own, because the response code is
 * global to the process.
 *
 * Run: php tests/status_after_challenge_test.php   (needs nothing but PHP)
 */
if (($argv[1] ?? '') === 'child') {
	// Just enough of Nextcloud for the two classes to load.
	eval('namespace OCP\AppFramework\Http; interface IOutput {
		public function setOutput($out); public function setReadfile($path);
		public function setHeader($header); public function getHttpResponseCode();
		public function setHttpResponseCode($code);
		public function setCookie($name, $value, $expire, $path, $domain, $secure, $httpOnly, $sameSite = "Lax");
	}');
	eval('namespace OCP\AppFramework; abstract class Controller {}');
	eval('namespace OCP\AppFramework\Http; class Output implements IOutput {
		public function setOutput($out) {} public function setReadfile($path) {}
		public function setHeader($header) { header($header); }
		public function getHttpResponseCode() { return http_response_code(); }
		public function setHttpResponseCode($code) { http_response_code($code); }
		public function setCookie($name, $value, $expire, $path, $domain, $secure, $httpOnly, $sameSite = "Lax") {}
	}');
	require __DIR__ . '/../lib/Service/ProxyService.php';
	require __DIR__ . '/../lib/Controller/ProxyController.php';
	$output = new \OCP\AppFramework\Http\Output();
	$status = (int)$argv[3];
	$headers = ['content-type' => 'text/html', 'www-authenticate' => 'Digest qop="auth",realm="NVRDVR",nonce="1"'];
	if ($argv[2] === 'buffered') {
		$c = (new ReflectionClass(\OCA\NetBase\Controller\ProxyController::class))->newInstanceWithoutConstructor();
		$m = new ReflectionMethod($c, 'writeBuffered');
		$m->setAccessible(true);
		$m->invoke($c, $output, ['status' => $status, 'headers' => $headers, 'body' => '{}', 'needsPassword' => false], 't', '');
	} else {
		$s = (new ReflectionClass(\OCA\NetBase\Service\ProxyService::class))->newInstanceWithoutConstructor();
		$m = new ReflectionMethod($s, 'sendHeaders');
		$m->setAccessible(true);
		$m->invoke($s, $output, $status, $headers);
	}
	echo http_response_code();
	exit(0);
}

$fail = 0;
foreach ([['buffered', 200], ['streamed', 200], ['buffered', 302]] as [$way, $status]) {
	$got = trim((string)shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . " child $way $status 2>&1"));
	$ok = $got === (string)$status;
	echo ($ok ? 'PASS' : 'FAIL') . "  a $status with WWW-Authenticate stays $status ($way) — got $got\n";
	if (!$ok) {
		$fail++;
	}
}
echo $fail ? "$fail FAILED\n" : "all passed\n";
exit($fail ? 1 : 0);
