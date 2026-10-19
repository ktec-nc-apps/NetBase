<?php
/**
 * Regression test: telling what a text file is written in, and writing it
 * another way (TextConvert) — the file-transfer "encoding and line endings"
 * action asked for on 2026-10-18.
 *
 * The checks that matter most are the refusals: a conversion that would turn
 * characters into "?" must stop and name them, and a file of bytes that is not
 * text must not be "converted" at all.
 *
 * Run: php tests/text_convert_test.php
 */
require __DIR__ . '/../lib/Service/TextConvertException.php';
require __DIR__ . '/../lib/Service/TextConvert.php';
use OCA\NetBase\Service\TextConvert;
use OCA\NetBase\Service\TextConvertException;

$fail = 0;
$ok = function (bool $c, string $m) use (&$fail): void { echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) { $fail++; } };
$sjis = fn (string $s): string => mb_convert_encoding($s, 'SJIS-win', 'UTF-8');
$euc = fn (string $s): string => mb_convert_encoding($s, 'eucJP-win', 'UTF-8');
$ja = "会議の議事録について\r\nお見積もりの件、よろしくお願いいたします。\r\n株式会社テスト　営業部\r\n";

// --- detection
$d = TextConvert::detect($ja);
$ok($d['encoding'] === 'UTF-8' && !$d['guessed'] && !$d['bom'], 'UTF-8 without a BOM is UTF-8, not a guess');
$d = TextConvert::detect("\xEF\xBB\xBF" . $ja);
$ok($d['encoding'] === 'UTF-8' && $d['bom'], 'a UTF-8 BOM is seen');
$d = TextConvert::detect($sjis($ja));
$ok($d['encoding'] === 'Shift_JIS' && $d['guessed'], 'Shift_JIS is guessed as Shift_JIS: ' . $d['encoding']);
$d = TextConvert::detect($euc($ja));
$ok($d['encoding'] === 'EUC-JP', 'EUC-JP is guessed as EUC-JP: ' . $d['encoding']);
$d = TextConvert::detect(mb_convert_encoding($ja, 'ISO-2022-JP-MS', 'UTF-8'));
$ok($d['encoding'] === 'ISO-2022-JP', 'ISO-2022-JP is seen by its escapes: ' . $d['encoding']);
$d = TextConvert::detect(mb_convert_encoding('A short note about it', 'UTF-16LE', 'UTF-8'));
$ok($d['encoding'] === 'UTF-16LE' && !$d['binary'], 'UTF-16LE without a BOM is seen: ' . $d['encoding']);
$d = TextConvert::detect("\xFE\xFF" . mb_convert_encoding($ja, 'UTF-16BE', 'UTF-8'));
$ok($d['encoding'] === 'UTF-16BE' && $d['bom'], 'UTF-16BE with a BOM');
$d = TextConvert::detect(mb_convert_encoding('안녕하세요. 회의 자료를 보내드립니다.', 'UHC', 'UTF-8'));
$ok($d['encoding'] === 'EUC-KR', 'Korean is guessed as EUC-KR: ' . $d['encoding']);
$d = TextConvert::detect(mb_convert_encoding('Café crème, déjà vu — naïve façade', 'Windows-1252', 'UTF-8'));
$ok($d['encoding'] === 'Windows-1252', 'Western text is guessed as Windows-1252: ' . $d['encoding']);
foreach ([["这是一个测试文件，请查收。会议记录已经更新。", "GB18030", "GB18030"], ["這是一個測試檔案，請查收。會議記錄已經更新。", "BIG-5", "Big5"],
	["ｶﾀｶﾅ半角とひらがな", "SJIS-win", "Shift_JIS"], ["Привет, это тестовый файл для проверки", "Windows-1251", "Windows-1251"],
	["Größe der Übertragung", "Windows-1252", "Windows-1252"], ["売上", "SJIS-win", "Shift_JIS"], ["株式会社", "eucJP-win", "EUC-JP"],
	["品名,数量,単価\r\nりんご,3,120\r\n", "SJIS-win", "Shift_JIS"], ["東京都千代田区丸の内一丁目", "SJIS-win", "Shift_JIS"], ["会议记录", "GB18030", "GB18030"]] as [$t, $mb, $want]) {
	$got = TextConvert::detect(mb_convert_encoding($t, $mb, 'UTF-8'))['encoding'];
	$ok($got === $want, $want . ' is guessed right: ' . $got . ' (' . mb_substr(str_replace("\r\n", ' ', $t), 0, 12) . ')');
}
$png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
$ok(TextConvert::detect($png)['binary'], 'a PNG is not text');
$ok(TextConvert::detect("plain ascii\n")['encoding'] === 'ASCII', 'plain ASCII is ASCII');

// --- line endings
$ok(TextConvert::newlineOf("a\r\nb\r\n") === 'crlf' && TextConvert::newlineOf("a\nb") === 'lf' && TextConvert::newlineOf("a\rb") === 'cr', 'CRLF, LF and CR are told apart');
$ok(TextConvert::newlineOf("a\r\nb\nc") === 'mixed' && TextConvert::newlineOf('abc') === 'none', 'mixed and none');

// --- inspect
$i = TextConvert::inspect($sjis($ja));
$ok($i['newline'] === 'crlf' && str_starts_with($i['preview'], '会議の議事録について'), 'inspect shows the first lines decoded');
$i = TextConvert::inspect($sjis($ja), 'EUC-JP');
$ok($i['encoding'] === 'EUC-JP' && !str_starts_with($i['preview'], '会議'), 'inspect with a chosen encoding decodes it that way (to show a wrong guess)');

// --- conversion
$r = TextConvert::convert($sjis($ja), 'auto', 'UTF-8', 'lf', 'keep', false);
$ok($r['bytes'] === str_replace("\r\n", "\n", $ja) && $r['from'] === 'Shift_JIS' && $r['changed'], 'Shift_JIS CRLF to UTF-8 LF');
$r = TextConvert::convert($ja, 'auto', 'Shift_JIS', 'keep', 'keep', false);
$ok($r['bytes'] === $sjis($ja) && $r['lost'] === [], 'UTF-8 to Shift_JIS, line endings kept');
$r = TextConvert::convert($ja, 'auto', 'keep', 'keep', 'add', false);
$ok($r['bytes'] === "\xEF\xBB\xBF" . $ja && $r['bom'], 'a BOM is added');
$r = TextConvert::convert("\xEF\xBB\xBF" . $ja, 'auto', 'keep', 'keep', 'remove', false);
$ok($r['bytes'] === $ja && !$r['bom'], 'a BOM is removed');
$r = TextConvert::convert("\xEF\xBB\xBF" . $ja, 'auto', 'UTF-16LE', 'keep', 'keep', false);
$ok($r['bytes'] === "\xFF\xFE" . mb_convert_encoding($ja, 'UTF-16LE', 'UTF-8'), 'UTF-8 with BOM to UTF-16LE keeps a BOM, in the new form');
$r = TextConvert::convert("\xEF\xBB\xBF" . $ja, 'auto', 'Shift_JIS', 'keep', 'keep', false);
$ok(!str_starts_with($r['bytes'], "\xEF\xBB\xBF") && !$r['bom'], 'Shift_JIS has no BOM to keep');
$r = TextConvert::convert("a\nb\n", 'auto', 'keep', 'crlf', 'keep', false);
$ok($r['bytes'] === "a\r\nb\r\n", 'LF to CRLF');
$r = TextConvert::convert("a\r\nb\rc\n", 'auto', 'keep', 'lf', 'keep', false);
$ok($r['bytes'] === "a\nb\nc\n", 'mixed to LF');
$r = TextConvert::convert(str_replace("\r\n", "\n", $ja), 'auto', 'UTF-8', 'keep', 'keep', false);
$ok(!$r['changed'], 'nothing to do is reported as unchanged');

// --- refusals
try { TextConvert::convert("絵文字🎉と①", 'auto', 'Shift_JIS', 'keep', 'keep', false); $ok(false, 'emoji to Shift_JIS should be refused'); }
catch (TextConvertException $e) { $ok($e->reason === 'lost' && in_array('🎉', $e->lost, true) && !in_array('①', $e->lost, true), 'emoji to Shift_JIS is refused, naming 🎉 (① is fine in Windows Shift_JIS)'); }
$r = TextConvert::convert("絵文字🎉", 'auto', 'Shift_JIS', 'keep', 'keep', true);
$ok($r['lost'] === ['🎉'] && str_contains($r['bytes'], '?'), 'and done when replacing is allowed, saying what was replaced');
try { TextConvert::convert($png, 'auto', 'UTF-8', 'lf', 'keep', false); $ok(false, 'a PNG should be refused'); }
catch (TextConvertException $e) { $ok($e->reason === 'binary', 'a binary file is refused'); }
try { TextConvert::convert($sjis($ja), 'UTF-8', 'Shift_JIS', 'keep', 'keep', false); $ok(false, 'Shift_JIS read as UTF-8 should be refused'); }
catch (TextConvertException $e) { $ok($e->reason === 'not-valid', 'bytes that are not the chosen source encoding are refused'); }
try { TextConvert::convert(str_repeat('a', TextConvert::MAX_BYTES + 1), 'auto', 'UTF-8', 'lf', 'keep', false); $ok(false, 'too large'); }
catch (TextConvertException $e) { $ok($e->reason === 'too-large', 'a file over the limit is refused'); }
// round trips through every target keep plain Japanese where the target can hold it
foreach (['UTF-16LE', 'UTF-16BE', 'Shift_JIS', 'EUC-JP', 'ISO-2022-JP', 'GB18030'] as $enc) {
	$there = TextConvert::convert("会議のお知らせ\n", 'auto', $enc, 'keep', 'keep', false);
	$back = TextConvert::convert($there['bytes'], $enc, 'UTF-8', 'keep', 'remove', false);
	$ok($back['bytes'] === "会議のお知らせ\n", 'UTF-8 → ' . $enc . ' → UTF-8 comes back the same');
}
echo $fail ? "$fail FAILED\n" : "ALL OK\n";
exit($fail ? 1 : 0);
