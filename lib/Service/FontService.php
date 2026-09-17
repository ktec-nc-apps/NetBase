<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\IConfig;

/**
 * The fonts this server can lend to a terminal.
 *
 * A terminal is drawn by the browser, not here, so a font installed on the
 * server is of no use until the file itself is handed over. This finds the
 * ones worth offering and nothing else:
 *
 *  - only the shapes a browser can load — TrueType and OpenType. Type 1
 *    (.pfb) and collections (.ttc) are refused however good the font is,
 *    because no browser will take them.
 *  - only fixed-width faces: fontconfig's "mono", and also its "dual", which
 *    is how a Japanese font says that Latin letters take half a cell and kana
 *    and kanji a whole one. Filtering on "mono" alone would throw away the
 *    very fonts a Japanese terminal wants.
 *
 * A path never comes from the browser: it asks for an id, and only a file
 * already in this list can be served.
 */
class FontService {
	/** Where fonts usually live, if fontconfig is not there to ask. */
	private const DIRS = [
		'/usr/share/fonts',
		'/usr/local/share/fonts',
		'/opt/fonts',
	];

	/** What a browser will actually load. */
	private const USABLE = ['ttf', 'otf'];

	/** fontconfig's spacing: 100 is monospace, 90 is half-and-full width. */
	private const FIXED_SPACING = ['90', '100'];

	/** Enough for any sane system; a guard against a runaway folder. */
	private const LIMIT = 200;

	/**
	 * Faces that are fixed-width by the letter of the rule but are no use for
	 * reading a terminal: emoji and symbol sets, the writing systems that are
	 * not text, and the sample and supplementary cuts that ship beside a real
	 * font. Left in, they would offer a ten-megabyte emoji font as a terminal
	 * face — and it would be the largest thing on the list.
	 */
	private const NOT_FOR_READING = '/emoji|symbol|signwrit|braille|sample|upper|csur|dingbat|icons?\b|awesome/i';

	/**
	 * The answer, kept for the length of the request.
	 *
	 * Listing fonts runs fc-list, and the settings screen asks more than once
	 * in a single request — reading the list, then checking a chosen font is
	 * on it. Without this, opening settings started the same process three
	 * times over.
	 *
	 * @var list<array{id: string, family: string, file: string, bytes: int, dual: bool}>|null
	 */
	private ?array $cached = null;

	public function __construct(
		private ExecService $exec,
		private IConfig $config,
	) {
	}

	/**
	 * Every font worth offering, one entry per family.
	 *
	 * @return list<array{id: string, family: string, file: string, bytes: int, dual: bool}>
	 */
	public function fonts(): array {
		if ($this->cached !== null) {
			return $this->cached;
		}
		$found = $this->viaFontconfig();
		if ($found === []) {
			$found = $this->viaWalk(self::DIRS);
		}
		$extra = trim($this->config->getAppValue('netbase', 'font_dir', ''));
		if ($extra !== '') {
			$found = array_merge($found, $this->viaWalk([$extra]));
		}

		// One file per family: the upright, regular weight is what a terminal
		// wants, so a bold or italic file is only taken when nothing else is.
		$best = [];
		foreach ($found as $font) {
			$family = $font['family'];
			if (!isset($best[$family]) || $this->rank($font['file']) < $this->rank($best[$family]['file'])) {
				$best[$family] = $font;
			}
		}
		$list = array_values($best);
		usort($list, static fn (array $a, array $b): int => strcasecmp($a['family'], $b['family']));
		$this->cached = array_slice($list, 0, self::LIMIT);
		return $this->cached;
	}

	/**
	 * One font by its id, or null. The only way a file is ever served.
	 *
	 * @return array{id: string, family: string, file: string, bytes: int, dual: bool}|null
	 */
	public function find(string $id): ?array {
		foreach ($this->fonts() as $font) {
			if (hash_equals($font['id'], $id)) {
				return $font;
			}
		}
		return null;
	}

	/** Ask fontconfig, which knows the family names and the spacing. */
	private function viaFontconfig(): array {
		$result = $this->exec->run('fc-list', ['--format=%{file}\t%{family[0]}\t%{spacing}\n'], 8.0);
		if (empty($result['ok'])) {
			return [];
		}
		$out = [];
		foreach (preg_split('/\R/', (string)$result['stdout']) ?: [] as $line) {
			$parts = explode("\t", $line);
			if (count($parts) < 2) {
				continue;
			}
			$file = trim($parts[0]);
			$family = trim($parts[1]);
			$spacing = trim($parts[2] ?? '');
			// An empty spacing means fontconfig does not claim the font is
			// fixed-width, and the proportional faces land here too — so only
			// what says so plainly is taken.
			if (!in_array($spacing, self::FIXED_SPACING, true)) {
				continue;
			}
			$entry = $this->entry($file, $family, $spacing === '90');
			if ($entry !== null) {
				$out[$entry['file']] = $entry;
			}
		}
		return array_values($out);
	}

	/**
	 * Walk folders instead. Without fontconfig there is no spacing to read, so
	 * the name has to speak for the font.
	 *
	 * @param list<string> $dirs
	 */
	private function viaWalk(array $dirs): array {
		$out = [];
		foreach ($dirs as $dir) {
			$root = realpath($dir);
			if ($root === false || !is_dir($root)) {
				continue;
			}
			// A folder that cannot be opened throws rather than warns, and `@`
			// does nothing about a thrown error. On a confined install — a snap,
			// for one — /usr/share/fonts is refused outright, and the exception
			// travelled all the way out of fonts(), through getSettings(), and
			// turned the whole settings screen into a 500. A font nobody can
			// read is not worth a broken screen: the folder is skipped instead.
			try {
				$walk = new \RecursiveIteratorIterator(
					new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS),
					\RecursiveIteratorIterator::LEAVES_ONLY,
				);
				// The same refusal can come from a folder deeper in, one item at
				// a time, so the walk itself is guarded too rather than only its
				// opening.
				$walk->setFlags(\RecursiveIteratorIterator::CATCH_GET_CHILD);
				foreach ($walk as $item) {
					if (count($out) >= self::LIMIT * 4) {
						break 2;
					}
					if (!$item->isFile()) {
						continue;
					}
					$name = $item->getFilename();
					// Only what reads as fixed-width, since nothing here can tell.
					if (preg_match('/mono|gothic|courier|consol|code|term/i', $name) !== 1) {
						continue;
					}
					$entry = $this->entry($item->getPathname(), $this->familyFromName($name), false);
					if ($entry !== null) {
						$out[$entry['file']] = $entry;
					}
				}
			} catch (\Throwable) {
				continue;
			}
		}
		return array_values($out);
	}

	/** One usable font, or null when the file is not one a browser can take. */
	private function entry(string $file, string $family, bool $dual): ?array {
		$real = realpath($file);
		if ($real === false || !is_file($real) || !is_readable($real)) {
			return null;
		}
		$extension = strtolower(pathinfo($real, PATHINFO_EXTENSION));
		if (!in_array($extension, self::USABLE, true)) {
			return null;
		}
		$bytes = (int)@filesize($real);
		if ($bytes <= 0) {
			return null;
		}
		$family = trim(explode(',', $family)[0]);
		if ($family === '') {
			$family = pathinfo($real, PATHINFO_FILENAME);
		}
		if (preg_match(self::NOT_FOR_READING, $family) === 1 || preg_match(self::NOT_FOR_READING, basename($real)) === 1) {
			return null;
		}
		return [
			'id' => substr(hash('sha256', $real), 0, 16),
			'family' => mb_substr($family, 0, 96),
			'file' => $real,
			'bytes' => $bytes,
			'dual' => $dual,
		];
	}

	/** Lower is better: the plain upright face of a family. */
	private function rank(string $file): int {
		$name = strtolower(pathinfo($file, PATHINFO_FILENAME));
		if (preg_match('/bold|italic|oblique|light|thin|black|heavy/', $name) === 1) {
			return 2;
		}
		if (preg_match('/regular|book|roman/', $name) === 1) {
			return 0;
		}
		return 1;
	}

	private function familyFromName(string $name): string {
		$base = pathinfo($name, PATHINFO_FILENAME);
		$base = preg_replace('/[-_](regular|bold|italic|oblique|book|roman).*$/i', '', $base) ?? $base;
		return trim(str_replace(['-', '_'], ' ', $base));
	}
}
