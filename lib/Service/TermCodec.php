<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/**
 * The character encoding of a terminal, as TeraTerm's "Kanji (receive)" and
 * "Kanji (transmit)" set it: what the far end sends is turned into UTF-8 for
 * the browser's terminal, and what is typed is turned back.
 *
 * A server's output arrives in pieces cut wherever the network cut it, so a
 * two-byte Shift_JIS or EUC-JP character can be split between two pieces. The
 * unfinished end of a piece is held back and put in front of the next one,
 * which is found without knowing the encoding's rules: the longest beginning
 * of the piece that is valid on its own is converted, and at most three bytes
 * after it wait. Bytes that are not valid anywhere are converted as they are
 * (mbstring puts "?" for them) rather than held back for ever.
 *
 * ISO-2022-JP is not offered: it switches character sets with escape
 * sequences, and a terminal's own control sequences are escape sequences too.
 */
final class TermCodec {
	/** id => [mbstring name, label]. */
	public const ENCODINGS = [
		'utf-8' => ['UTF-8', 'UTF-8'],
		'shift_jis' => ['SJIS-win', 'Shift_JIS'],
		'euc-jp' => ['eucJP-win', 'EUC-JP'],
		'gb18030' => ['GB18030', 'GB18030'],
		'big5' => ['BIG-5', 'Big5'],
		'euc-kr' => ['UHC', 'EUC-KR'],
		'windows-1252' => ['Windows-1252', 'Windows-1252'],
		'iso-8859-1' => ['ISO-8859-1', 'ISO-8859-1'],
		'windows-1251' => ['Windows-1251', 'Windows-1251'],
		'koi8-r' => ['KOI8-R', 'KOI8-R'],
	];

	private string $name;
	private string $held = '';

	public function __construct(string $id) {
		$this->name = self::ENCODINGS[$id][0] ?? 'UTF-8';
	}

	public static function valid(string $id): bool {
		return isset(self::ENCODINGS[$id]);
	}

	public function passthrough(): bool {
		return $this->name === 'UTF-8';
	}

	/** What the far end sent, as UTF-8 for the browser. */
	public function decode(string $bytes): string {
		if ($this->passthrough() || $bytes === '') {
			return $bytes;
		}
		$all = $this->held . $bytes;
		$this->held = '';
		$cut = strlen($all);
		// Up to three bytes may wait, and when no more than that has arrived
		// it may all wait (a lead byte on its own, one byte per piece).
		for ($back = 0; $back <= min(3, strlen($all)); $back++) {
			if (mb_check_encoding(substr($all, 0, strlen($all) - $back), $this->name)) {
				$cut = strlen($all) - $back;
				break;
			}
		}
		$this->held = (string)substr($all, $cut);
		return (string)mb_convert_encoding(substr($all, 0, $cut), 'UTF-8', $this->name);
	}

	/** What was typed (UTF-8), in the far end's encoding. */
	public function encode(string $utf8): string {
		if ($this->passthrough() || $utf8 === '') {
			return $utf8;
		}
		return (string)mb_convert_encoding($utf8, $this->name, 'UTF-8');
	}

	/** Whatever is still held back when the terminal ends. */
	public function flush(): string {
		$rest = $this->held;
		$this->held = '';
		return $rest === '' ? '' : (string)mb_convert_encoding($rest, 'UTF-8', $this->name);
	}
}
