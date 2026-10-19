<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/**
 * One mail message, taken apart the way a mail program does it.
 *
 * The headers are unfolded and their encoded words decoded; the body is
 * walked through every multipart, each part decoded from base64 or
 * quoted-printable and turned into UTF-8 from whatever character set it
 * names. What comes out is what a reader wants: the plain text, the HTML, the
 * attachments with their names and sizes, and the inline images an HTML
 * message refers to by cid:.
 *
 * Japanese mail is the case this is written for as much as any: ISO-2022-JP
 * in headers split across several encoded words, Shift_JIS with the Windows
 * characters, and old programs that put raw 8-bit text in a header without
 * encoding it at all. The Windows-compatible character sets (SJIS-win,
 * eucJP-win, ISO-2022-JP-MS) are used so that ① and ㈱ survive.
 *
 * Nothing here needs an extension beyond mbstring and iconv.
 */
final class MimeMessage {
	/** Character-set names as mail writes them, mapped to the ones mbstring knows. */
	private const CHARSETS = [
		'shift_jis' => 'SJIS-win', 'shift-jis' => 'SJIS-win', 'sjis' => 'SJIS-win', 'x-sjis' => 'SJIS-win',
		'ms_kanji' => 'SJIS-win', 'cp932' => 'SJIS-win', 'windows-31j' => 'SJIS-win',
		'euc-jp' => 'eucJP-win', 'x-euc-jp' => 'eucJP-win',
		'iso-2022-jp' => 'ISO-2022-JP-MS', 'iso-2022-jp-1' => 'ISO-2022-JP-MS', 'iso-2022-jp-2' => 'ISO-2022-JP-MS',
		'us-ascii' => 'UTF-8', 'ascii' => 'UTF-8', 'utf8' => 'UTF-8', 'utf-8' => 'UTF-8',
		'ks_c_5601-1987' => 'UHC', 'euc-kr' => 'UHC', 'gb2312' => 'GB18030', 'gbk' => 'GB18030',
		'big5' => 'BIG-5', 'latin1' => 'ISO-8859-1', 'iso-8859-1' => 'Windows-1252',
	];

	/** How many multiparts deep to go: real mail is rarely past four. */
	private const DEPTH = 10;

	/** @return array{headers: array<string, list<string>>, body: string} */
	public static function split(string $raw): array {
		$crlf = strpos($raw, "\r\n\r\n");
		$lf = strpos($raw, "\n\n");
		if ($crlf === false && $lf === false) {
			return ['headers' => self::headers($raw), 'body' => ''];
		}
		if ($crlf !== false && ($lf === false || $crlf <= $lf)) {
			return ['headers' => self::headers(substr($raw, 0, $crlf)), 'body' => (string)substr($raw, $crlf + 4)];
		}
		return ['headers' => self::headers(substr($raw, 0, (int)$lf)), 'body' => (string)substr($raw, (int)$lf + 2)];
	}

	/** @return array<string, list<string>> by lower-case name, folded lines joined */
	public static function headers(string $block): array {
		$out = [];
		$name = null;
		foreach (preg_split("/\r?\n/", $block) ?: [] as $line) {
			if ($line === '') {
				continue;
			}
			if (($line[0] === ' ' || $line[0] === "\t") && $name !== null) {
				$last = count($out[$name]) - 1;
				$out[$name][$last] .= ' ' . ltrim($line);
				continue;
			}
			$colon = strpos($line, ':');
			if ($colon === false) {
				continue;
			}
			$name = strtolower(trim(substr($line, 0, $colon)));
			$out[$name][] = trim(substr($line, $colon + 1));
		}
		return $out;
	}

	/** @param array<string, list<string>> $headers */
	public static function first(array $headers, string $name): string {
		return $headers[$name][0] ?? '';
	}

	/**
	 * A header as text: encoded words decoded, raw 8-bit guessed.
	 *
	 * Consecutive encoded words in the same character set are joined before
	 * they are converted, because a sender may cut a multi-byte character — or
	 * an ISO-2022-JP escape sequence — across two of them.
	 */
	public static function decodeHeader(string $value): string {
		if ($value === '') {
			return '';
		}
		if (!str_contains($value, '=?')) {
			return self::toUtf8($value, '');
		}
		$out = '';
		$pending = '';
		$pendingCharset = '';
		$flush = static function () use (&$out, &$pending, &$pendingCharset): void {
			if ($pending !== '') {
				$out .= self::toUtf8($pending, $pendingCharset);
			}
			$pending = '';
			$pendingCharset = '';
		};
		$rest = $value;
		while (preg_match('/=\?([^?*]+)(?:\*[^?]*)?\?([bBqQ])\?([^?]*)\?=/', $rest, $m, PREG_OFFSET_CAPTURE)) {
			$before = substr($rest, 0, $m[0][1]);
			// Whitespace between two encoded words is not part of the text (RFC 2047 §6.2).
			if (!($pending !== '' && trim($before) === '')) {
				$flush();
				$out .= self::toUtf8($before, '');
			}
			$charset = strtolower($m[1][0]);
			$bytes = strtoupper($m[2][0]) === 'B'
				? (string)base64_decode($m[3][0])
				: quoted_printable_decode(str_replace('_', ' ', $m[3][0]));
			if ($pending !== '' && $charset !== $pendingCharset) {
				$flush();
			}
			$pending .= $bytes;
			$pendingCharset = $charset;
			$rest = (string)substr($rest, $m[0][1] + strlen($m[0][0]));
		}
		$flush();
		return $out . self::toUtf8($rest, '');
	}

	/** Bytes in a named (or unnamed) character set, as UTF-8. */
	public static function toUtf8(string $bytes, string $charset): string {
		if ($bytes === '') {
			return '';
		}
		$cs = strtolower(trim($charset, " \t\"'"));
		if ($cs === '') {
			if (mb_check_encoding($bytes, 'UTF-8')) {
				return $bytes;
			}
			$cs = (string)(mb_detect_encoding($bytes, ['ISO-2022-JP', 'UTF-8', 'eucJP-win', 'SJIS-win'], true) ?: 'windows-1252');
			$cs = strtolower($cs);
		}
		$enc = self::CHARSETS[$cs] ?? $cs;
		if ($enc === 'UTF-8') {
			return mb_check_encoding($bytes, 'UTF-8') ? $bytes : mb_scrub($bytes, 'UTF-8');
		}
		static $known = null;
		$known ??= array_map('strtolower', mb_list_encodings());
		if (in_array(strtolower($enc), $known, true)) {
			$converted = @mb_convert_encoding($bytes, 'UTF-8', $enc);
			if (is_string($converted)) {
				return $converted;
			}
		}
		$converted = @iconv($cs, 'UTF-8//IGNORE', $bytes);
		return is_string($converted) ? $converted : mb_scrub($bytes, 'UTF-8');
	}

	/**
	 * "text/plain; charset=iso-2022-jp; name*=UTF-8''%E8%A6%8B.txt" taken apart.
	 *
	 * @return array{value: string, params: array<string, string>}
	 */
	public static function params(string $value): array {
		$pieces = [];
		$cur = '';
		$quoted = false;
		$len = strlen($value);
		for ($i = 0; $i < $len; $i++) {
			$c = $value[$i];
			if ($c === '\\' && $quoted && $i + 1 < $len) {
				$cur .= $value[++$i];
				continue;
			}
			if ($c === '"') {
				$quoted = !$quoted;
				continue;
			}
			if ($c === ';' && !$quoted) {
				$pieces[] = $cur;
				$cur = '';
				continue;
			}
			$cur .= $c;
		}
		$pieces[] = $cur;
		$main = strtolower(trim((string)array_shift($pieces)));
		$out = [];
		$continued = [];
		foreach ($pieces as $piece) {
			$eq = strpos($piece, '=');
			if ($eq === false) {
				continue;
			}
			$key = strtolower(trim(substr($piece, 0, $eq)));
			$val = trim(substr($piece, $eq + 1));
			// RFC 2231: name*0*=, name*1= ... pieces of one long value
			if (preg_match('/^([^*]+)\*(\d+)(\*?)$/', $key, $m)) {
				$continued[$m[1]][(int)$m[2]] = [$val, $m[3] === '*'];
				continue;
			}
			if (str_ends_with($key, '*')) {
				$continued[substr($key, 0, -1)][0] = [$val, true];
				continue;
			}
			$out[$key] = $val;
		}
		foreach ($continued as $name => $parts) {
			ksort($parts);
			$bytes = '';
			$charset = '';
			foreach ($parts as $n => [$val, $encoded]) {
				if ($encoded) {
					if ($n === array_key_first($parts) && preg_match("/^([^']*)'[^']*'(.*)$/s", $val, $m)) {
						$charset = $m[1];
						$val = $m[2];
					}
					$bytes .= rawurldecode($val);
				} else {
					$bytes .= $val;
				}
			}
			$out[$name] = self::toUtf8($bytes, $charset);
		}
		return ['value' => $main, 'params' => $out];
	}

	/**
	 * The parts a reader wants.
	 *
	 * Every leaf part is numbered in the order it is met; that number is how
	 * an attachment is asked for again ($want), so the whole message need not
	 * travel to the browser to save one file out of it.
	 *
	 * @return array{headers: array<string, list<string>>, text: ?string, html: ?string,
	 *               attachments: list<array{index: int, name: string, type: string, size: int}>,
	 *               inline: array<string, array{type: string, data: string}>, wanted: ?array{name: string, type: string, data: string}}
	 */
	public static function parse(string $raw, int $want = 0): array {
		$top = self::split($raw);
		$out = ['headers' => $top['headers'], 'text' => null, 'html' => null, 'attachments' => [], 'inline' => [], 'wanted' => null];
		$index = 0;
		self::walk($top['headers'], $top['body'], $out, $index, 0, $want);
		if ($out['text'] === null && $out['html'] !== null) {
			$out['text'] = self::htmlToText($out['html']);
		}
		return $out;
	}

	/** @param array<string, list<string>> $headers */
	private static function walk(array $headers, string $body, array &$out, int &$index, int $depth, int $want): void {
		$type = self::params(self::first($headers, 'content-type') ?: 'text/plain');
		$mime = $type['value'] !== '' ? $type['value'] : 'text/plain';
		if (str_starts_with($mime, 'multipart/') && $depth < self::DEPTH && ($type['params']['boundary'] ?? '') !== '') {
			foreach (self::splitMultipart($body, $type['params']['boundary']) as $part) {
				$inner = self::split($part);
				self::walk($inner['headers'], $inner['body'], $out, $index, $depth + 1, $want);
			}
			return;
		}
		$index++;
		$disposition = self::params(self::first($headers, 'content-disposition'));
		$name = self::decodeHeader($disposition['params']['filename'] ?? ($type['params']['name'] ?? ''));
		$cid = trim(self::first($headers, 'content-id'), " <>");
		$data = self::decodeBody($body, self::first($headers, 'content-transfer-encoding'));
		$attached = $disposition['value'] === 'attachment';
		$readable = ($mime === 'text/plain' || $mime === 'text/html') && !$attached;
		if ($readable && $mime === 'text/plain' && $out['text'] === null) {
			$out['text'] = self::toUtf8($data, $type['params']['charset'] ?? '');
			return;
		}
		if ($readable && $mime === 'text/html' && $out['html'] === null) {
			$out['html'] = self::toUtf8($data, $type['params']['charset'] ?? '');
			return;
		}
		if ($cid !== '' && str_starts_with($mime, 'image/') && !$attached) {
			$out['inline'][$cid] = ['type' => $mime, 'data' => $data];
			if ($name === '') {
				return;
			}
		}
		if ($name === '') {
			$name = $mime === 'message/rfc822' ? 'message-' . $index . '.eml' : 'part-' . $index . self::extensionFor($mime);
		}
		$name = str_replace(['/', '\\', "\0"], '_', $name);
		$out['attachments'][] = ['index' => $index, 'name' => $name, 'type' => $mime, 'size' => strlen($data)];
		if ($index === $want) {
			$out['wanted'] = ['name' => $name, 'type' => $mime, 'data' => $data];
		}
	}

	/** @return list<string> the parts between the boundaries, without the boundary lines */
	private static function splitMultipart(string $body, string $boundary): array {
		$marker = '--' . $boundary;
		$end = strpos($body, $marker . '--');
		if ($end !== false) {
			$body = substr($body, 0, $end);
		}
		$pieces = preg_split('/(?:^|\r?\n)' . preg_quote($marker, '/') . '[ \t]*\r?\n/', $body) ?: [];
		array_shift($pieces);
		$parts = [];
		foreach ($pieces as $piece) {
			// The line break before the next boundary belongs to the boundary.
			$parts[] = (string)preg_replace('/\r?\n\z/', '', $piece);
		}
		return $parts;
	}

	private static function decodeBody(string $body, string $encoding): string {
		$encoding = strtolower(trim($encoding));
		if ($encoding === 'base64') {
			return (string)base64_decode((string)preg_replace('/[^A-Za-z0-9+\/=]/', '', $body));
		}
		if ($encoding === 'quoted-printable') {
			return quoted_printable_decode(str_replace("\r\n", "\n", $body));
		}
		return $body;
	}

	/** Plain text from HTML, for a message that came without a text part. */
	public static function htmlToText(string $html): string {
		$html = (string)preg_replace('#<(script|style|head)\b[^>]*>.*?</\1>#is', '', $html);
		$html = (string)preg_replace('#<br\s*/?>#i', "\n", $html);
		$html = (string)preg_replace('#</(p|div|tr|li|h[1-6]|blockquote|table)>#i', "\n", $html);
		$text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
		$text = (string)preg_replace("/[ \t]+\n/", "\n", $text);
		return trim((string)preg_replace("/\n{3,}/", "\n\n", $text));
	}

	private static function extensionFor(string $mime): string {
		return [
			'application/pdf' => '.pdf', 'image/jpeg' => '.jpg', 'image/png' => '.png', 'image/gif' => '.gif',
			'text/plain' => '.txt', 'text/html' => '.html', 'text/calendar' => '.ics', 'application/zip' => '.zip',
		][$mime] ?? '.bin';
	}
}
