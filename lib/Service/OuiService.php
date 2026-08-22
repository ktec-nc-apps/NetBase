<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\App\IAppManager;

/**
 * MAC address vendor lookup against the bundled IEEE registries
 * (MA-L / MA-M / MA-S, see data/oui.source).
 *
 * The database is a single tab-separated file sorted by prefix, so lookups are
 * a binary search over the file itself — no parsing of 53k rows into memory.
 */
class OuiService {
	private ?\Closure $open = null;
	/** @var resource|null */
	private $fh = null;
	private int $size = 0;
	/** @var array<string,string> */
	private array $cache = [];

	public function __construct(
		private IAppManager $appManager,
	) {
	}

	private function file(): ?string {
		$path = $this->appManager->getAppPath('netbase') . '/data/oui.txt';
		return is_readable($path) ? $path : null;
	}

	/** Number of vendor prefixes in the bundled database (0 when unavailable). */
	public function count(): int {
		$path = $this->file();
		if ($path === null) {
			return 0;
		}
		$n = 0;
		$fh = fopen($path, 'rb');
		while (fgets($fh) !== false) {
			$n++;
		}
		fclose($fh);
		return $n;
	}

	/**
	 * @return array{vendor: string, prefix: string, local: bool, multicast: bool}
	 */
	public function describe(string $mac): array {
		$hex = strtoupper(preg_replace('/[^0-9A-Fa-f]/', '', $mac) ?? '');
		$first = strlen($hex) >= 2 ? hexdec(substr($hex, 0, 2)) : 0;
		$local = (bool)($first & 0x02);
		$multicast = (bool)($first & 0x01);

		return [
			'vendor' => $this->lookup($hex),
			'prefix' => strlen($hex) >= 6 ? substr($hex, 0, 6) : '',
			'local' => $local,
			'multicast' => $multicast,
		];
	}

	/** Vendor name for a MAC address, or '' when the prefix is unregistered. */
	public function lookup(string $mac): string {
		$hex = strtoupper(preg_replace('/[^0-9A-Fa-f]/', '', $mac) ?? '');
		if (strlen($hex) < 6) {
			return '';
		}
		if (isset($this->cache[substr($hex, 0, 9)])) {
			return $this->cache[substr($hex, 0, 9)];
		}
		$path = $this->file();
		if ($path === null) {
			return '';
		}
		if ($this->fh === null) {
			$this->fh = fopen($path, 'rb');
			$this->size = (int)filesize($path);
			if ($this->fh === false) {
				return '';
			}
		}

		// MA-S (36 bit) is the most specific, then MA-M (28 bit), then MA-L (24 bit).
		foreach ([9, 7, 6] as $len) {
			$hit = $this->search(substr($hex, 0, $len), $len);
			if ($hit !== '') {
				$this->cache[substr($hex, 0, 9)] = $hit;
				return $hit;
			}
		}
		$this->cache[substr($hex, 0, 9)] = '';
		return '';
	}

	/** Binary search for an exact prefix of the given length. */
	private function search(string $key, int $len): string {
		$lo = 0;
		$hi = $this->size;
		$guard = 0;
		while ($lo < $hi && $guard++ < 64) {
			$mid = intdiv($lo + $hi, 2);
			fseek($this->fh, $mid);
			if ($mid > 0) {
				fgets($this->fh); // discard the partial line
			}
			$pos = ftell($this->fh);
			$line = fgets($this->fh);
			if ($line === false) {
				$hi = $mid;
				continue;
			}
			$tab = strpos($line, "\t");
			if ($tab === false) {
				$hi = $mid;
				continue;
			}
			$prefix = substr($line, 0, $tab);
			// Prefixes of different lengths are interleaved; compare on the
			// common leading part so the search still converges.
			$cmp = strcmp(substr($prefix, 0, $len), $key);
			if ($cmp === 0 && strlen($prefix) === $len) {
				return rtrim(substr($line, $tab + 1), "\r\n");
			}
			if ($cmp < 0 || ($cmp === 0 && strlen($prefix) < $len)) {
				$lo = $pos + strlen($line);
			} else {
				$hi = $mid;
			}
		}
		// Neighbourhood scan: entries sharing the leading part sit next to each
		// other, and the one we want may be a few lines either side.
		fseek($this->fh, max(0, $lo - 512));
		$buf = fread($this->fh, 1536);
		if ($buf === false) {
			return '';
		}
		foreach (explode("\n", $buf) as $line) {
			$tab = strpos($line, "\t");
			if ($tab !== false && substr($line, 0, $tab) === $key) {
				return rtrim(substr($line, $tab + 1), "\r\n");
			}
		}
		return '';
	}
}
