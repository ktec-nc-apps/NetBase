<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/**
 * The archive and compression formats file transfer can make and open, which
 * tools on the far end each one needs, and the commands that do it.
 *
 * Nothing here runs anything: it builds command lines for a server where
 * NetBase has a shell, and says what can be done there from the list of tools
 * the server reported. Where there is no shell (FTP, or an SFTP-only account),
 * a few formats are made and opened on this server instead, in PHP; which ones
 * depends on the PHP extensions here (see phpCan).
 */
final class ArchiveFormats {
	/**
	 * id => extension, the tools each way, and whether it holds a single file
	 * (gzip and its kin compress one file; they are not archives).
	 * 'make' and 'open' list alternatives: any one of them is enough, and a
	 * '+' joins tools that are needed together.
	 */
	public const FORMATS = [
		'zip' => ['ext' => '.zip', 'single' => false, 'make' => ['zip', '7z', 'python3'], 'open' => ['unzip', '7z', 'bsdtar', 'python3']],
		'tar' => ['ext' => '.tar', 'single' => false, 'make' => ['tar'], 'open' => ['tar']],
		'tgz' => ['ext' => '.tar.gz', 'single' => false, 'make' => ['tar+gzip'], 'open' => ['tar+gzip']],
		'tbz2' => ['ext' => '.tar.bz2', 'single' => false, 'make' => ['tar+bzip2'], 'open' => ['tar+bzip2']],
		'txz' => ['ext' => '.tar.xz', 'single' => false, 'make' => ['tar+xz'], 'open' => ['tar+xz']],
		'tzst' => ['ext' => '.tar.zst', 'single' => false, 'make' => ['tar-zstd', 'tar+zstd'], 'open' => ['tar-zstd', 'tar+zstd']],
		'7z' => ['ext' => '.7z', 'single' => false, 'make' => ['7z'], 'open' => ['7z']],
		'rar' => ['ext' => '.rar', 'single' => false, 'make' => [], 'open' => ['unrar', '7z']],
		'gz' => ['ext' => '.gz', 'single' => true, 'make' => ['gzip'], 'open' => ['gzip']],
		'bz2' => ['ext' => '.bz2', 'single' => true, 'make' => ['bzip2'], 'open' => ['bzip2']],
		'xz' => ['ext' => '.xz', 'single' => true, 'make' => ['xz'], 'open' => ['xz']],
		'zst' => ['ext' => '.zst', 'single' => true, 'make' => ['zstd'], 'open' => ['zstd']],
	];

	/** Other names the same formats go by, longest first where it matters. */
	private const ALIASES = [
		'.tar.gz' => 'tgz', '.tgz' => 'tgz', '.tar.bz2' => 'tbz2', '.tbz2' => 'tbz2', '.tbz' => 'tbz2',
		'.tar.xz' => 'txz', '.txz' => 'txz', '.tar.zst' => 'tzst', '.tzst' => 'tzst',
		'.tar' => 'tar', '.zip' => 'zip', '.7z' => '7z', '.rar' => 'rar',
		'.gz' => 'gz', '.bz2' => 'bz2', '.xz' => 'xz', '.zst' => 'zst',
	];

	/** The tools looked for on the far end; 7z goes by three names. */
	public const TOOLS = ['zip', 'unzip', 'tar', 'gzip', 'bzip2', 'xz', 'zstd', '7z', '7za', '7zz', 'unrar', 'bsdtar', 'python3'];

	/** The format a file name says it is, or null. */
	public static function detect(string $name): ?string {
		$lower = strtolower($name);
		foreach (self::ALIASES as $ext => $id) {
			if (str_ends_with($lower, $ext) && strlen($lower) > strlen($ext)) {
				return $id;
			}
		}
		return null;
	}

	/** The name with the format's extension taken off ("site.tar.gz" → "site"). */
	public static function stem(string $name): string {
		$lower = strtolower($name);
		foreach (self::ALIASES as $ext => $id) {
			if (str_ends_with($lower, $ext) && strlen($lower) > strlen($ext)) {
				return substr($name, 0, -strlen($ext));
			}
		}
		return $name;
	}

	/**
	 * One shell line that names the tools the server has, one per line, and
	 * "tar-zstd" where its tar compresses with zstd itself.
	 */
	public static function probeCommand(): string {
		$tools = implode(' ', self::TOOLS);
		return 'for t in ' . $tools . '; do command -v "$t" >/dev/null 2>&1 && echo "$t"; done; '
			. 'tar --zstd -cf /dev/null -T /dev/null >/dev/null 2>&1 && echo tar-zstd; true';
	}

	/** @return list<string> the tools in a probe's answer */
	public static function parseProbe(string $out): array {
		$known = array_merge(self::TOOLS, ['tar-zstd']);
		$have = [];
		foreach (preg_split('/\s+/', trim($out)) ?: [] as $t) {
			if (in_array($t, $known, true)) {
				$have[] = $t;
			}
		}
		if (array_intersect(['7za', '7zz'], $have) !== [] && !in_array('7z', $have, true)) {
			$have[] = '7z';
		}
		return array_values(array_unique($have));
	}

	/**
	 * What this server can do without a shell on the far end.
	 *
	 * @return array{make: list<string>, open: list<string>}
	 */
	public static function phpCan(): array {
		$make = [];
		$open = [];
		if (class_exists(\ZipArchive::class)) {
			$make[] = 'zip';
			$open[] = 'zip';
		}
		if (class_exists(\PharData::class)) {
			$make[] = 'tar';
			$open[] = 'tar';
			if (function_exists('gzencode')) {
				array_push($make, 'tgz');
				array_push($open, 'tgz', 'gz');
			}
			if (function_exists('bzcompress')) {
				array_push($make, 'tbz2');
				array_push($open, 'tbz2', 'bz2');
			}
		}
		return ['make' => $make, 'open' => $open];
	}

	/**
	 * For each format: can it be made, can it be opened, given the far end's
	 * tools (null when there is no shell there).
	 *
	 * @param list<string>|null $tools
	 * @return array<string, array{ext: string, single: bool, make: bool, open: bool}>
	 */
	public static function availability(?array $tools): array {
		$php = self::phpCan();
		$out = [];
		foreach (self::FORMATS as $id => $f) {
			$out[$id] = [
				'ext' => $f['ext'], 'single' => $f['single'],
				'make' => in_array($id, $php['make'], true) || ($tools !== null && self::anyOf($f['make'], $tools)),
				'open' => $tools === null ? in_array($id, $php['open'], true) : (self::anyOf($f['open'], $tools) || (in_array($id, $php['open'], true) && !$f['single'])),
			];
		}
		return $out;
	}

	/** @param list<string> $alternatives */
	private static function anyOf(array $alternatives, array $tools): bool {
		foreach ($alternatives as $alt) {
			if (array_diff(explode('+', $alt), $tools) === []) {
				return true;
			}
		}
		return false;
	}

	/** The name 7-Zip goes by on that server. */
	private static function sevenZip(array $tools): string {
		foreach (['7z', '7zz', '7za'] as $t) {
			if (in_array($t, $tools, true)) {
				return $t;
			}
		}
		return '7z';
	}

	/**
	 * The command that makes the archive, run in the folder the entries are
	 * in, writing to the absolute path in the shell variable $o. Null when
	 * the server has none of the tools it needs.
	 *
	 * @param list<string> $names entry names in the current folder
	 * @param list<string> $tools
	 */
	public static function makeCommand(string $id, array $names, array $tools): ?string {
		$list = implode(' ', array_map(static fn (string $n): string => escapeshellarg('./' . $n), $names));
		$has = static fn (string $t): bool => in_array($t, $tools, true);
		$z = self::sevenZip($tools);
		return match ($id) {
			'zip' => $has('zip') ? 'zip -r -q -y "$o" ' . $list
				: ($has('7z') ? $z . ' a -tzip -bd -y "$o" ' . $list . ' >/dev/null'
				: ($has('python3') ? 'python3 -m zipfile -c "$o" ' . $list : null)),
			'tar' => $has('tar') ? 'tar -cf "$o" ' . $list : null,
			'tgz' => $has('tar') && $has('gzip') ? 'tar -czf "$o" ' . $list : null,
			'tbz2' => $has('tar') && $has('bzip2') ? 'tar -cjf "$o" ' . $list : null,
			'txz' => $has('tar') && $has('xz') ? 'tar -cJf "$o" ' . $list : null,
			// Without tar's own --zstd the archive is piped through zstd, and
			// tar's exit status is kept aside so a failure is not lost in the pipe.
			'tzst' => $has('tar-zstd') ? 'tar --zstd -cf "$o" ' . $list
				: ($has('tar') && $has('zstd') ? '(tar -cf - ' . $list . '; echo $? > "$o.rc") | zstd -q -f -o "$o" && [ "$(cat "$o.rc")" = 0 ]; r=$?; rm -f "$o.rc"; [ "$r" = 0 ]' : null),
			'7z' => $has('7z') ? $z . ' a -bd -y "$o" ' . $list . ' >/dev/null' : null,
			'gz' => count($names) === 1 && $has('gzip') ? 'gzip -c -- ' . $list . ' > "$o"' : null,
			'bz2' => count($names) === 1 && $has('bzip2') ? 'bzip2 -c -- ' . $list . ' > "$o"' : null,
			'xz' => count($names) === 1 && $has('xz') ? 'xz -c -- ' . $list . ' > "$o"' : null,
			'zst' => count($names) === 1 && $has('zstd') ? 'zstd -q -c -- ' . $list . ' > "$o"' : null,
			default => null,
		};
	}

	/**
	 * The command that opens the archive at $archive into the folder $into,
	 * which already exists and is empty. For the one-file formats $into is
	 * instead the path of the file to write. Null when nothing there can.
	 *
	 * @param list<string> $tools
	 */
	public static function openCommand(string $id, string $archive, string $into, array $tools): ?string {
		$a = escapeshellarg($archive);
		$d = escapeshellarg($into);
		$has = static fn (string $t): bool => in_array($t, $tools, true);
		$z = self::sevenZip($tools);
		return match ($id) {
			'zip' => $has('unzip') ? 'unzip -q -o ' . $a . ' -d ' . $d
				: ($has('7z') ? $z . ' x -bd -y -o' . $d . ' ' . $a . ' >/dev/null'
				: ($has('bsdtar') ? 'bsdtar -xf ' . $a . ' -C ' . $d
				: ($has('python3') ? 'python3 -m zipfile -e ' . $a . ' ' . $d : null))),
			'tar' => $has('tar') ? 'tar -xf ' . $a . ' -C ' . $d : null,
			'tgz' => $has('tar') && $has('gzip') ? 'tar -xzf ' . $a . ' -C ' . $d : null,
			'tbz2' => $has('tar') && $has('bzip2') ? 'tar -xjf ' . $a . ' -C ' . $d : null,
			'txz' => $has('tar') && $has('xz') ? 'tar -xJf ' . $a . ' -C ' . $d : null,
			'tzst' => $has('tar-zstd') ? 'tar --zstd -xf ' . $a . ' -C ' . $d
				: ($has('tar') && $has('zstd') ? 'zstd -q -dc ' . $a . ' | tar -xf - -C ' . $d : null),
			'7z' => $has('7z') ? $z . ' x -bd -y -o' . $d . ' ' . $a . ' >/dev/null' : null,
			'rar' => $has('unrar') ? 'unrar x -o+ -idq ' . $a . ' ' . escapeshellarg(rtrim($into, '/') . '/')
				: ($has('7z') ? $z . ' x -bd -y -o' . $d . ' ' . $a . ' >/dev/null' : null),
			'gz' => $has('gzip') ? 'gzip -dc ' . $a . ' > ' . $d : null,
			'bz2' => $has('bzip2') ? 'bzip2 -dc ' . $a . ' > ' . $d : null,
			'xz' => $has('xz') ? 'xz -dc ' . $a . ' > ' . $d : null,
			'zst' => $has('zstd') ? 'zstd -q -dc ' . $a . ' > ' . $d : null,
			default => null,
		};
	}
}
