<?php
/**
 * Regression test: errors from the server reach the screen in the reader's language.
 *
 * A Japanese screen showed "That sudo password was not accepted by the
 * server." in English (2026-10-19): the sentence was raised in English, as all
 * errors are, but was in no translation file, so the lookup on the way out had
 * nothing to find. Sentences with a value glued in ("Sign-in refused: " . the
 * server's reply) could never be found at all.
 *
 * This checks the lookup itself, with the Japanese file as it ships, and that
 * every sentence raised in lib/ is one the translation files know.
 *
 * No Nextcloud is needed: its translator is played here, vsprintf and all.
 *
 * Run: php tests/error_words_test.php
 */

namespace OCP {
	if (!interface_exists(IL10N::class)) {
		interface IL10N {
		}
	}
}

namespace {
	require __DIR__ . '/../lib/Service/Worded.php';
	require __DIR__ . '/../lib/Service/WordedRuntimeException.php';
	require __DIR__ . '/../lib/Service/WordedInvalidArgumentException.php';
	require __DIR__ . '/../lib/Service/L10nService.php';

	use OCA\NetBase\Service\L10nService;
	use OCA\NetBase\Service\WordedInvalidArgumentException;
	use OCA\NetBase\Service\WordedRuntimeException;

	/** Nextcloud's translator as far as it matters here: look up, then vsprintf, always. */
	class FakeL10N implements OCP\IL10N {
		public function __construct(private array $tr) {
		}
		public function t($text, $parameters = []) {
			return vsprintf($this->tr[$text] ?? $text, (array)$parameters);
		}
	}

	$fail = 0;
	$check = static function (bool $ok, string $what) use (&$fail): void {
		echo ($ok ? 'ok   ' : 'FAIL ') . $what . "\n";
		if (!$ok) {
			$fail++;
		}
	};
	$file = static fn (string $lang): array => json_decode((string)file_get_contents(__DIR__ . '/../l10n/' . $lang . '.json'), true)['translations'];
	$ja = $file('ja');
	$l = new FakeL10N($ja);

	$said = L10nService::wordsOf($l, new \RuntimeException('That sudo password was not accepted by the server.'));
	$check($said === $ja['That sudo password was not accepted by the server.'] && preg_match('/\p{Han}|\p{Hiragana}|\p{Katakana}/u', $said) === 1,
		'a refused sudo password is said in Japanese (' . $said . ')');

	$said = L10nService::wordsOf($l, new WordedRuntimeException('Sign-in refused: %s', ['a3 NO [AUTHENTICATIONFAILED] 100% wrong']));
	$check($said === sprintf($ja['Sign-in refused: %s'], 'a3 NO [AUTHENTICATIONFAILED] 100% wrong'),
		'a sentence with the server\'s reply in it is translated, the reply kept as it came (' . $said . ')');

	$said = L10nService::wordsOf($l, new WordedRuntimeException('Choose a RegiBase collection for %s connections first.', ['Mail accounts']));
	$check(str_contains($said, $ja['Mail accounts']) && !str_contains($said, 'Mail accounts'),
		'a label put into a sentence is translated too (' . $said . ')');

	$said = L10nService::wordsOf($l, new WordedInvalidArgumentException('Not an IPv4 address: %s', ['10.0.0.300']));
	$check($said === sprintf($ja['Not an IPv4 address: %s'], '10.0.0.300'), 'a refused value is said in Japanese (' . $said . ')');

	$said = L10nService::wordsOf($l, new \RuntimeException('disk 100% full'));
	$check($said === 'disk 100% full', 'a message with no translation and a "%" comes back as it was');

	$check((new WordedRuntimeException('Sign-in refused: %s', ['x']))->getMessage() === 'Sign-in refused: x', 'the log still gets the English sentence with its value');

	// Every sentence raised in lib/ is in every translation file. A code that
	// the screen words itself (TextConvertException's reasons) is a different
	// class and is not counted.
	$raised = [];
	$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(__DIR__ . '/../lib', FilesystemIterator::SKIP_DOTS));
	foreach ($it as $f) {
		$path = (string)$f;
		if (!str_ends_with($path, '.php') || str_contains($path, '/Vendor/') || str_ends_with($path, 'NmapService.php')) {
			continue;
		}
		preg_match_all("/new \\\\?(?:Runtime|InvalidArgument|Forbidden|WordedRuntime|WordedInvalidArgument)Exception\\(\\s*'((?:[^'\\\\]|\\\\.)*)'\\s*[,)]/", (string)file_get_contents($path), $m);
		foreach ($m[1] as $s) {
			$raised[str_replace("\\'", "'", $s)] = basename($path);
		}
	}
	$check(count($raised) > 100, count($raised) . ' sentences raised in lib/');
	foreach (glob(__DIR__ . '/../l10n/*.json') as $json) {
		$lang = basename($json, '.json');
		$tr = $file($lang);
		$missing = array_keys(array_diff_key($raised, $tr));
		$check($missing === [], $lang . ': every sentence raised has a translation' . ($missing ? ' — missing: ' . implode(' | ', array_slice($missing, 0, 5)) : ''));
	}

	echo $fail === 0 ? "error words: all good\n" : "error words: $fail failed\n";
	exit($fail === 0 ? 0 : 1);
}
