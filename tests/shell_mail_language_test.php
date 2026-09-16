<?php
/**
 * Regression test: the shell's verification email must follow NetBase's own
 * language, not the Nextcloud account's.
 *
 * NetBase can be set to a different language from the rest of Nextcloud, per
 * account. Text written on the server therefore has to be translated through
 * L10nService, which resolves that setting. ShellGateService was injecting
 * OCP\IL10N directly, so an account left in Japanese received a Japanese code
 * email even with NetBase switched to English.
 *
 * Static, so it needs nothing but PHP: it reads the constructor and fails if
 * IL10N is injected anywhere in the class.
 *
 * Run: php tests/shell_mail_language_test.php
 */
$path = __DIR__ . '/../lib/Service/ShellGateService.php';
$src = file_get_contents($path);
if ($src === false) { fwrite(STDERR, "cannot read ShellGateService.php\n"); exit(2); }

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  ($got)") . "\n";
	if (!$ok) { $fail++; }
};

// Isolate the constructor's parameter list.
$at = strpos($src, 'public function __construct(');
if ($at === false) { fwrite(STDERR, "no constructor found\n"); exit(2); }
$open = strpos($src, '(', $at);
$depth = 0; $end = $open;
for ($i = $open, $n = strlen($src); $i < $n; $i++) {
	if ($src[$i] === '(') { $depth++; }
	elseif ($src[$i] === ')') { $depth--; if ($depth === 0) { $end = $i; break; } }
}
$params = substr($src, $open, $end - $open + 1);

$check(
	'the constructor takes L10nService',
	preg_match('/\bL10nService\s+\$\w+/', $params) === 1,
	'constructor: ' . preg_replace('/\s+/', ' ', $params),
);
$check(
	'the constructor does NOT take IL10N',
	preg_match('/\bIL10N\s+\$\w+/', $params) !== 1,
	'IL10N is injected, so the account language would win',
);
$check('the class does not import OCP\\IL10N', strpos($src, 'use OCP\IL10N;') === false);

// The strings that go into the message must still be translated.
foreach ([
	'%s — code to open a shell',
	'Your verification code is: %s',
] as $needle) {
	$check('the email still translates ' . json_encode($needle), strpos($src, $needle) !== false);
}

// L10nService must actually resolve NetBase's own per-account language.
$l10n = (string)file_get_contents(__DIR__ . '/../lib/Service/L10nService.php');
$check(
	'L10nService reads the netbase language setting',
	strpos($l10n, "'language'") !== false && strpos($l10n, 'getUserValue') !== false,
);

$lint = shell_exec('php -l ' . escapeshellarg($path) . ' 2>&1');
$check('ShellGateService lints clean', strpos((string)$lint, 'No syntax errors') !== false);

echo $fail === 0 ? "\nALL PASS\n" : "\n$fail FAILED\n";
exit($fail === 0 ? 0 : 1);
