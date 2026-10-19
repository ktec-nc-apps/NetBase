<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/**
 * What a text file is written in, and the same text written another way:
 * another character encoding, other line endings, with or without a BOM.
 *
 * Nothing here touches a file. It is handed the bytes and hands bytes back, so
 * it is the same for a file on a far server and one in Nextcloud, and it can
 * be tested on its own.
 *
 * A conversion that would change the text is refused rather than done: a
 * character the target cannot hold would otherwise come out as "?", and the
 * file would be quietly wrong. The refusal names the characters, and the
 * reader may then ask for them to be replaced after all.
 */
final class TextConvert {
	/** Larger than this is not read as text here. */
	public const MAX_BYTES = 33554432;

	/**
	 * The encodings offered, by the name a reader knows, and the name mbstring
	 * uses for it. The Japanese ones are the Windows variants (SJIS-win and so
	 * on), which is what files called Shift_JIS really are: the plain ones
	 * lack ①, ㈱ and the other characters Windows added.
	 */
	public const ENCODINGS = [
		'UTF-8' => 'UTF-8',
		'UTF-16LE' => 'UTF-16LE',
		'UTF-16BE' => 'UTF-16BE',
		'Shift_JIS' => 'SJIS-win',
		'EUC-JP' => 'eucJP-win',
		'ISO-2022-JP' => 'ISO-2022-JP-MS',
		'GB18030' => 'GB18030',
		'Big5' => 'BIG-5',
		'EUC-KR' => 'UHC',
		'Windows-1252' => 'Windows-1252',
		'ISO-8859-1' => 'ISO-8859-1',
		'Windows-1251' => 'Windows-1251',
		'KOI8-R' => 'KOI8-R',
	];

	/** The encodings that can carry a byte order mark. */
	private const WITH_BOM = ['UTF-8' => "\xEF\xBB\xBF", 'UTF-16LE' => "\xFF\xFE", 'UTF-16BE' => "\xFE\xFF"];

	/**
	 * What the bytes are: encoding, line endings, BOM, and the first lines as
	 * text so the reader can see whether the guess is right.
	 *
	 * @return array{encoding: string, guessed: bool, bom: bool, newline: string, binary: bool, preview: string, size: int}
	 */
	public static function inspect(string $bytes, string $from = 'auto'): array {
		$size = strlen($bytes);
		$found = self::detect($bytes);
		if ($from !== 'auto' && isset(self::ENCODINGS[$from])) {
			$found = ['encoding' => $from, 'guessed' => false, 'bom' => self::hasBom($bytes, $from), 'binary' => false];
		}
		if ($found['binary']) {
			return ['encoding' => '', 'guessed' => false, 'bom' => false, 'newline' => 'none', 'binary' => true, 'preview' => '', 'size' => $size];
		}
		$text = self::decode($bytes, $found['encoding'], $found['bom'], true);
		$lines = preg_split('/\r\n|\r|\n/', mb_substr($text, 0, 2000, 'UTF-8')) ?: [];
		$preview = implode("\n", array_map(static fn (string $l): string => mb_strimwidth($l, 0, 160, '…', 'UTF-8'), array_slice($lines, 0, 4)));
		return [
			'encoding' => $found['encoding'], 'guessed' => $found['guessed'], 'bom' => $found['bom'],
			'newline' => self::newlineOf($text), 'binary' => false, 'preview' => $preview, 'size' => $size,
		];
	}

	/**
	 * The same text, written as asked.
	 *
	 * @param string $from an ENCODINGS key, or 'auto'
	 * @param string $to an ENCODINGS key, or 'keep'
	 * @param string $newline 'keep', 'lf', 'crlf' or 'cr'
	 * @param string $bom 'keep', 'add' or 'remove'
	 * @return array{bytes: string, from: string, to: string, newline: string, bom: bool, changed: bool, lost: list<string>}
	 */
	public static function convert(string $bytes, string $from, string $to, string $newline, string $bom, bool $allowLoss): array {
		if (strlen($bytes) > self::MAX_BYTES) {
			throw new TextConvertException('too-large');
		}
		$found = self::detect($bytes);
		if ($from === 'auto') {
			if ($found['binary']) {
				throw new TextConvertException('binary');
			}
			$from = $found['encoding'];
			$hadBom = $found['bom'];
		} else {
			if (!isset(self::ENCODINGS[$from])) {
				throw new \InvalidArgumentException('Unknown encoding');
			}
			$hadBom = self::hasBom($bytes, $from);
		}
		if ($from === 'ASCII') {
			$from = 'UTF-8';
		}
		$target = $to === 'keep' ? $from : $to;
		if (!isset(self::ENCODINGS[$target])) {
			throw new \InvalidArgumentException('Unknown encoding');
		}
		$body = $hadBom ? substr($bytes, strlen(self::WITH_BOM[$from])) : $bytes;
		if (!mb_check_encoding($body, self::ENCODINGS[$from]) && !$allowLoss) {
			throw new TextConvertException('not-valid', [$from]);
		}
		$text = self::decode($bytes, $from, $hadBom, $allowLoss);
		if ($newline !== 'keep') {
			$eol = ['lf' => "\n", 'crlf' => "\r\n", 'cr' => "\r"][$newline] ?? null;
			if ($eol === null) {
				throw new \InvalidArgumentException('Unknown line ending');
			}
			$text = str_replace(["\r\n", "\r"], "\n", $text);
			if ($eol !== "\n") {
				$text = str_replace("\n", $eol, $text);
			}
		}
		$out = $target === 'UTF-8' ? $text : mb_convert_encoding($text, self::ENCODINGS[$target], 'UTF-8');
		$lost = [];
		if ($target !== 'UTF-8' && mb_convert_encoding($out, 'UTF-8', self::ENCODINGS[$target]) !== $text) {
			$lost = self::unrepresentable($text, $target);
			if ($lost !== [] && !$allowLoss) {
				throw new TextConvertException('lost', [$target], $lost);
			}
		}
		$withBom = match ($bom) {
			'add' => isset(self::WITH_BOM[$target]),
			'remove' => false,
			default => $hadBom && isset(self::WITH_BOM[$target]),
		};
		if ($withBom) {
			$out = self::WITH_BOM[$target] . $out;
		}
		return [
			'bytes' => $out, 'from' => $from, 'to' => $target, 'newline' => self::newlineOf($text),
			'bom' => $withBom, 'changed' => $out !== $bytes, 'lost' => $lost,
		];
	}

	/**
	 * The encoding of some bytes, and whether that is a guess.
	 *
	 * A BOM settles it, and so does text that is valid UTF-8 (other encodings
	 * almost never are by chance). Everything else is a guess between the
	 * legacy encodings, made by which one turns the bytes into the most
	 * ordinary characters of its own script.
	 *
	 * @return array{encoding: string, guessed: bool, bom: bool, binary: bool}
	 */
	public static function detect(string $bytes): array {
		foreach (['UTF-8', 'UTF-16LE', 'UTF-16BE'] as $enc) {
			if (str_starts_with($bytes, self::WITH_BOM[$enc])) {
				return ['encoding' => $enc, 'guessed' => false, 'bom' => true, 'binary' => false];
			}
		}
		$sample = substr($bytes, 0, 65536);
		if (str_contains($sample, "\0")) {
			$utf16 = self::utf16Without($sample);
			if ($utf16 !== null) {
				return ['encoding' => $utf16, 'guessed' => true, 'bom' => false, 'binary' => false];
			}
			return ['encoding' => '', 'guessed' => false, 'bom' => false, 'binary' => true];
		}
		if (preg_match('/[\x01-\x08\x0E-\x1A\x1C-\x1F]/', $sample) && preg_match_all('/[\x01-\x08\x0E-\x1A\x1C-\x1F]/', $sample) > max(4, strlen($sample) / 100)) {
			return ['encoding' => '', 'guessed' => false, 'bom' => false, 'binary' => true];
		}
		if (!preg_match('/[\x80-\xFF]/', $bytes)) {
			if (preg_match('/\x1B[\$\(][@BJ]/', $bytes)) {
				return ['encoding' => 'ISO-2022-JP', 'guessed' => false, 'bom' => false, 'binary' => false];
			}
			return ['encoding' => 'ASCII', 'guessed' => false, 'bom' => false, 'binary' => false];
		}
		if (mb_check_encoding($bytes, 'UTF-8')) {
			return ['encoding' => 'UTF-8', 'guessed' => false, 'bom' => false, 'binary' => false];
		}
		// Each legacy encoding turns the same bytes into some text; the right one
		// turns them into the characters its own users write most. So every
		// character is weighed by how ordinary it is in that encoding (the first,
		// everyday level of its kanji, hanzi or hangul counts fully; the rarer
		// levels count less), times the bytes it took, and the share of the
		// non-ASCII bytes so explained decides. A sample cut mid-character is
		// allowed one byte short.
		$high = max(1, (int)preg_match_all('/[\x80-\xFF]/', $sample));
		$best = 'Windows-1252';
		$bestShare = -1.0;
		foreach (['Shift_JIS', 'EUC-JP', 'EUC-KR', 'GB18030', 'Big5', 'Windows-1251', 'Windows-1252'] as $enc) {
			$mb = self::ENCODINGS[$enc];
			$part = mb_check_encoding($sample, $mb) ? $sample : substr($sample, 0, -1);
			if (!mb_check_encoding($part, $mb)) {
				continue;
			}
			$share = self::plausible(mb_convert_encoding($part, 'UTF-8', $mb), $enc) / $high;
			if ($share > $bestShare + 0.02) {
				$bestShare = $share;
				$best = $enc;
			}
		}
		return ['encoding' => $best, 'guessed' => true, 'bom' => false, 'binary' => false];
	}

	/**
	 * How many of the non-ASCII bytes the text explains as ordinary writing in
	 * that encoding's language.
	 */
	private static function plausible(string $text, string $enc): float {
		$chars = mb_str_split($text, 1, 'UTF-8');
		$mb = self::ENCODINGS[$enc];
		$memo = [];
		$sum = 0.0;
		$n = count($chars);
		$asciiLetter = static fn (?string $c): bool => $c !== null && strlen($c) === 1 && ctype_alpha($c);
		for ($i = 0; $i < $n; $i++) {
			$ch = $chars[$i];
			if (strlen($ch) === 1) {
				continue;
			}
			if (!isset($memo[$ch])) {
				$raw = mb_convert_encoding($ch, $mb, 'UTF-8');
				$memo[$ch] = [strlen($raw), self::weight($ch, $raw, $enc)];
			}
			[$len, $w] = $memo[$ch];
			if ($enc === 'Windows-1251' && $w > 0 && ($asciiLetter($chars[$i - 1] ?? null) || $asciiLetter($chars[$i + 1] ?? null))) {
				// A Cyrillic letter inside a Latin word is a Western accent read wrongly.
				$w = 0.0;
			}
			if ($enc === 'Windows-1252' && $w > 0 && $i > 0 && preg_match('/^[\x{00C0}-\x{00FF}]$/u', $chars[$i - 1])) {
				// A run of accented letters is another script read as Latin-1.
				$w = 0.2;
			}
			$sum += $w * $len;
		}
		if (($enc === 'Shift_JIS' || $enc === 'EUC-JP') && $n >= 8
			&& !preg_match('/[\x{3041}-\x{3096}\x{30A1}-\x{30FA}\x{FF66}-\x{FF9D}]/u', $text)) {
			// Japanese is almost never written without kana; Korean or Chinese
			// read as Japanese comes out as kanji alone.
			$sum *= 0.6;
		}
		return $sum;
	}

	/** How ordinary one character is for that encoding, 0 to 1. */
	private static function weight(string $ch, string $raw, string $enc): float {
		$cp = mb_ord($ch, 'UTF-8');
		$lead = $raw === '' ? 0 : ord($raw[0]);
		$trail = strlen($raw) >= 2 ? ord($raw[1]) : 0;
		$kana = ($cp >= 0x3041 && $cp <= 0x3096) || ($cp >= 0x30A1 && $cp <= 0x30FA) || $cp === 0x30FC;
		$han = $cp >= 0x4E00 && $cp <= 0x9FFF;
		$cjkPunct = ($cp >= 0x3000 && $cp <= 0x303F) || ($cp >= 0xFF01 && $cp <= 0xFF5E);
		$halfKana = $cp >= 0xFF61 && $cp <= 0xFF9F;
		$hangul = $cp >= 0xAC00 && $cp <= 0xD7A3;
		if (($cp >= 0xE000 && $cp <= 0xF8FF) || $cp === 0xFFFD) {
			return 0.0;
		}
		return match ($enc) {
			// JIS level 1 kanji: Shift_JIS lead 0x88-0x9F, EUC-JP lead 0xB0-0xCF.
			'Shift_JIS' => $kana || $cjkPunct ? 1.0 : ($han ? ($lead >= 0x88 && $lead <= 0x9F ? 1.0 : 0.4) : ($halfKana ? 0.7 : 0.1)),
			'EUC-JP' => $kana || $cjkPunct ? 1.0 : ($han ? ($lead >= 0xB0 && $lead <= 0xCF ? 1.0 : 0.4) : ($halfKana ? 0.7 : 0.1)),
			// KS X 1001 hangul: lead 0xB0-0xC8 with a trail of 0xA1 or more.
			'EUC-KR' => $hangul ? ($lead >= 0xB0 && $lead <= 0xC8 && $trail >= 0xA1 ? 1.0 : 0.2) : ($cjkPunct ? 0.5 : ($han ? 0.2 : 0.1)),
			// GB2312 level 1 hanzi: lead 0xB0-0xD7, trail 0xA1 or more; level 2 to 0xF7.
			'GB18030' => $cjkPunct ? 1.0 : ($han ? ($trail >= 0xA1 && strlen($raw) === 2 ? ($lead >= 0xB0 && $lead <= 0xD7 ? 1.0 : ($lead <= 0xF7 ? 0.6 : 0.2)) : 0.2) : 0.1),
			// Big5 frequent hanzi: lead 0xA4-0xC6; the less frequent from 0xC9.
			'Big5' => $cjkPunct ? 1.0 : ($han ? ($lead >= 0xA4 && $lead <= 0xC6 ? 1.0 : 0.5) : 0.1),
			'Windows-1251' => ($cp >= 0x0410 && $cp <= 0x044F) || $cp === 0x0401 || $cp === 0x0451 || in_array($cp, [0xAB, 0xBB, 0x2013, 0x2014, 0x2116, 0x201C, 0x201D, 0x201E, 0x2019, 0x2026], true) ? 1.0 : 0.0,
			'Windows-1252' => ($cp >= 0xC0 && $cp <= 0xFF && $cp !== 0xD7 && $cp !== 0xF7) || in_array($cp, [0xAB, 0xBB, 0xB0, 0x20AC, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026], true) ? 1.0 : 0.2,
			default => 0.0,
		};
	}

	/** UTF-16 without a BOM shows as a zero in every other byte of plain text. */
	private static function utf16Without(string $sample): ?string {
		$n = strlen($sample) - strlen($sample) % 2;
		if ($n < 4) {
			return null;
		}
		$even = 0;
		$odd = 0;
		for ($i = 0; $i < $n; $i += 2) {
			$even += $sample[$i] === "\0" ? 1 : 0;
			$odd += $sample[$i + 1] === "\0" ? 1 : 0;
		}
		$pairs = $n / 2;
		if ($odd > $pairs * 0.3 && $even < $pairs * 0.05) {
			return 'UTF-16LE';
		}
		if ($even > $pairs * 0.3 && $odd < $pairs * 0.05) {
			return 'UTF-16BE';
		}
		return null;
	}

	private static function hasBom(string $bytes, string $enc): bool {
		return isset(self::WITH_BOM[$enc]) && str_starts_with($bytes, self::WITH_BOM[$enc]);
	}

	private static function decode(string $bytes, string $enc, bool $bom, bool $lenient): string {
		if ($enc === 'ASCII') {
			$enc = 'UTF-8';
		}
		$body = $bom ? substr($bytes, strlen(self::WITH_BOM[$enc])) : $bytes;
		if ($enc === 'UTF-8') {
			return $lenient ? mb_scrub($body, 'UTF-8') : $body;
		}
		return mb_convert_encoding($body, 'UTF-8', self::ENCODINGS[$enc]);
	}

	/** 'lf', 'crlf', 'cr', 'mixed' or 'none'. */
	public static function newlineOf(string $text): string {
		$crlf = substr_count($text, "\r\n");
		$cr = substr_count($text, "\r") - $crlf;
		$lf = substr_count($text, "\n") - $crlf;
		$kinds = array_filter(['crlf' => $crlf, 'lf' => $lf, 'cr' => $cr]);
		if ($kinds === []) {
			return 'none';
		}
		return count($kinds) > 1 ? 'mixed' : (string)array_key_first($kinds);
	}

	/**
	 * The characters of the text that would not come back the same from the
	 * target encoding: those it lacks, and those it maps to a look-alike.
	 *
	 * @return list<string>
	 */
	private static function unrepresentable(string $text, string $target): array {
		$mb = self::ENCODINGS[$target];
		$out = [];
		foreach (array_unique(mb_str_split($text, 1, 'UTF-8')) as $ch) {
			if (mb_convert_encoding(mb_convert_encoding($ch, $mb, 'UTF-8'), 'UTF-8', $mb) !== $ch) {
				$out[] = $ch;
				if (count($out) >= 20) {
					break;
				}
			}
		}
		return $out;
	}
}
