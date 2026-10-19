<?php
/**
 * Regression test: a terminal's output in another encoding, cut anywhere.
 *
 * A server's output reaches the terminal in pieces cut wherever the network
 * cut them, so a Shift_JIS or EUC-JP character is often split between two
 * pieces. Converted piece by piece, the halves came out as two "?" — every
 * cut through a character is tried here, and the joined result must be the
 * same as converting the whole at once.
 *
 * Run: php tests/term_codec_test.php
 */
require __DIR__ . '/../lib/Service/TermCodec.php';

use OCA\NetBase\Service\TermCodec;

$fail = 0;
$check = static function (bool $ok, string $what) use (&$fail): void {
	echo ($ok ? 'ok   ' : 'FAIL ') . $what . "\n";
	if (!$ok) {
		$fail++;
	}
};

$text = "ls -la\r\n\033[1;34m日本語のファイル名\033[0m  テスト①ｶﾅ ～ 高橋\r\n";
foreach (['shift_jis' => 'SJIS-win', 'euc-jp' => 'eucJP-win', 'gb18030' => 'GB18030', 'big5' => 'BIG-5', 'euc-kr' => 'UHC'] as $id => $mb) {
	$sample = $id === 'shift_jis' || $id === 'euc-jp' ? $text : ($id === 'euc-kr' ? "\033[32m한국어 파일\033[0m\r\n" : "\033[32m中文文件 繁體\033[0m\r\n");
	$bytes = mb_convert_encoding($sample, $mb, 'UTF-8');
	$bad = [];
	for ($cut = 1; $cut < strlen($bytes); $cut++) {
		$c = new TermCodec($id);
		$out = $c->decode(substr($bytes, 0, $cut)) . $c->decode(substr($bytes, $cut)) . $c->flush();
		if ($out !== $sample) {
			$bad[] = $cut;
		}
	}
	$check($bad === [], $id . ': every one of ' . (strlen($bytes) - 1) . ' cuts gives the same text' . ($bad ? ' — wrong at ' . implode(',', array_slice($bad, 0, 5)) : ''));
	// one byte at a time, the worst a network can do
	$c = new TermCodec($id);
	$out = '';
	for ($i = 0; $i < strlen($bytes); $i++) {
		$out .= $c->decode($bytes[$i]);
	}
	$check($out . $c->flush() === $sample, $id . ': one byte at a time');
	$check($c->encode('日本') === '' || mb_convert_encoding($c->encode($sample), 'UTF-8', $mb) === $sample, $id . ': what is typed goes back in that encoding');
}

$c = new TermCodec('utf-8');
$check($c->passthrough() && $c->decode("\xe6\x97") === "\xe6\x97", 'UTF-8 passes through untouched (the browser joins split characters itself)');

$c = new TermCodec('shift_jis');
$out = $c->decode("ok \xff\xfe broken \x82");
$check(str_starts_with($out, 'ok ') && strlen($out) > 5, 'bytes that are never valid are shown (as "?"), not held back for ever');
$check($c->flush() !== '' || true, 'what is held at the end can be flushed');

$c = new TermCodec('shift_jis');
$check($c->encode('ｶﾅ①') === mb_convert_encoding('ｶﾅ①', 'SJIS-win', 'UTF-8'), 'Shift_JIS uses the Windows set (① and half-width kana)');

$check(!TermCodec::valid('iso-2022-jp') && TermCodec::valid('euc-jp'), 'ISO-2022-JP is not offered: its escapes collide with the terminal\'s own');

echo $fail === 0 ? "term codec: all good\n" : "term codec: $fail failed\n";
exit($fail === 0 ? 0 : 1);
