<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/**
 * What a device window did, recorded while someone finds out why a device's
 * page misbehaves through the proxy.
 *
 * Off unless the person turns it on, for one device, and then only for a
 * while. It keeps what shows where a page goes wrong — which requests were
 * made, what came back, how big and how fast — and never what was in them: no
 * bodies, no form values, no cookies, no passwords, no ticket, and none of the
 * values after the "?" of an address. What is kept is meant to be copied out
 * and posted for help, so it has to be safe to show to anyone.
 *
 * One recording per person and device. The device is its host, not its full
 * address, so a page that moves from http to https, or to another port of the
 * same device, is still followed.
 */
class DeviceDiagService {
	/** The most requests one recording keeps; a page that never stops asking is cut off here. */
	public const MAX_ENTRIES = 400;
	/** A recording nobody stopped ends by itself after this many seconds. */
	public const LIFETIME = 1800;

	public function start(string $userId, string $base): void {
		$file = $this->file($userId, $base);
		file_put_contents($file, json_encode(['started' => microtime(true), 'entries' => []]), LOCK_EX);
		@chmod($file, 0600);
	}

	/**
	 * End a recording and hand back what it holds.
	 *
	 * @return array{started: float, entries: list<array<string, mixed>>}|null
	 */
	public function stop(string $userId, string $base): ?array {
		$file = $this->file($userId, $base);
		if (!is_file($file)) {
			return null;
		}
		$data = json_decode((string)file_get_contents($file), true);
		@unlink($file);
		return is_array($data) ? ['started' => (float)($data['started'] ?? 0), 'entries' => (array)($data['entries'] ?? [])] : null;
	}

	/** Checked on every proxied request, so it is one stat and nothing more. */
	public function active(string $userId, string $base): bool {
		$file = $this->file($userId, $base);
		$mtime = @filemtime($file);
		if ($mtime === false) {
			return false;
		}
		if (time() - $mtime > self::LIFETIME) {
			@unlink($file);
			return false;
		}
		return true;
	}

	/**
	 * Add one request to the recording, if there is one.
	 *
	 * @param array<string, mixed> $entry already made safe by the caller (see path())
	 */
	public function record(string $userId, string $base, array $entry): void {
		if (!$this->active($userId, $base)) {
			return;
		}
		$handle = @fopen($this->file($userId, $base), 'c+');
		if ($handle === false) {
			return;
		}
		try {
			// Pages ask for many things at once, each in a request of its own.
			flock($handle, LOCK_EX);
			$data = json_decode((string)stream_get_contents($handle), true);
			if (!is_array($data)) {
				return;
			}
			$entries = (array)($data['entries'] ?? []);
			if (count($entries) >= self::MAX_ENTRIES) {
				return;
			}
			$entry['t'] = round(microtime(true) - (float)($data['started'] ?? microtime(true)), 2);
			$entries[] = $entry;
			$data['entries'] = $entries;
			ftruncate($handle, 0);
			rewind($handle);
			fwrite($handle, (string)json_encode($data));
			fflush($handle);
		} finally {
			flock($handle, LOCK_UN);
			fclose($handle);
		}
	}

	/**
	 * A device path and query as it may be shown to anyone.
	 *
	 * The names in a query say what a page asked for and stay; the values are
	 * what it asked with — a session, a password a router puts in the address —
	 * and become "*". A long run of letters and digits inside the path is
	 * usually a session too (";stok=…" on some routers) and becomes "…".
	 */
	public static function path(string $path, string $query = ''): string {
		$path = '/' . ltrim($path, '/');
		$path = (string)preg_replace_callback('#[^/;=,&]+#', static fn (array $m): string => self::opaque($m[0]) ? '…' : $m[0], $path);
		if ($query === '') {
			return $path;
		}
		$pairs = [];
		foreach (explode('&', $query) as $pair) {
			if ($pair === '') {
				continue;
			}
			$name = explode('=', $pair, 2)[0];
			$name = self::opaque($name) ? '…' : $name;
			$pairs[] = str_contains($pair, '=') ? $name . '=*' : $name;
		}
		return $path . ($pairs === [] ? '' : '?' . implode('&', $pairs));
	}

	/**
	 * A redirect's target as it may be shown: on the same device, its path;
	 * elsewhere, where it goes, with the same care for what is in it.
	 */
	public static function location(string $location, string $base): string {
		$parts = parse_url($location);
		if ($parts === false) {
			return '…';
		}
		$path = self::path((string)($parts['path'] ?? '/'), (string)($parts['query'] ?? ''));
		if (!isset($parts['host'])) {
			return $path;
		}
		$own = parse_url($base, PHP_URL_HOST);
		$where = strtolower((string)$parts['host']) === strtolower((string)$own) ? '' : (string)$parts['host'];
		$scheme = (string)($parts['scheme'] ?? '');
		$port = isset($parts['port']) ? ':' . $parts['port'] : '';
		return $scheme . '://' . ($where === '' ? (string)$own : $where) . $port . $path;
	}

	/** Long enough and mixed enough to be somebody's session rather than a name. */
	private static function opaque(string $part): bool {
		if (strlen($part) < 16 || preg_match('/^[A-Za-z0-9_\-+.%~]+$/', $part) !== 1) {
			return false;
		}
		if (preg_match('/\.(?:s?html?|js|css|cgi|asp|aspx|php|jsp|json|xml|png|gif|jpe?g|svg|ico|woff2?|ttf|txt|htm)$/i', $part) === 1) {
			return false;
		}
		return preg_match('/\d/', $part) === 1 && preg_match('/[A-Za-z]/', $part) === 1;
	}

	private function file(string $userId, string $base): string {
		$host = strtolower((string)(parse_url($base, PHP_URL_HOST) ?: $base));
		$dir = sys_get_temp_dir() . '/netbase-proxy';
		if (!is_dir($dir)) {
			@mkdir($dir, 0700, true);
		}
		return $dir . '/diag-' . hash('sha256', $userId . "\0" . $host) . '.json';
	}
}
