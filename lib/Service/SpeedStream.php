<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/**
 * The speed test's data, made and checked as it flows.
 *
 * A test of a terabyte cannot be a file on this server's disk, nor a string in
 * its memory. This is a stream instead: reading from a "source" hands out
 * random bytes until the size asked for has gone, and writing to a "sink"
 * takes bytes in and keeps only their count and a checksum. Both are ordinary
 * PHP streams, so FTP, SFTP and SCP all read and write them the way they read
 * and write files.
 *
 * The random bytes come from eight blocks of one MiB made once, taken in turn.
 * Compression on the way — which would flatter the result — looks back 32 KiB
 * at most, so it never sees a repeat. The checksum is xxh128: fast enough not
 * to be what is being measured, and plenty to tell whether what came back is
 * what went out.
 */
final class SpeedStream {
	private const SCHEME = 'netbase-speed';
	private const BLOCK = 1048576;

	/** @var resource|null set by PHP for stream wrappers */
	public $context;

	/** @var array<string, array<string, mixed>> */
	private static array $jobs = [];

	private string $id = '';

	/** @return array{0: resource, 1: string} a stream that gives $total random bytes, and its id */
	public static function source(int $total): array {
		self::register();
		$id = bin2hex(random_bytes(8));
		$pool = [];
		for ($i = 0; $i < 8; $i++) {
			$pool[] = random_bytes(self::BLOCK);
		}
		self::$jobs[$id] = ['source' => true, 'total' => $total, 'pos' => 0, 'pool' => $pool, 'hash' => hash_init('xxh128')];
		$stream = fopen(self::SCHEME . '://' . $id, 'rb');
		if (!is_resource($stream)) {
			throw new \RuntimeException('The test data could not be started');
		}
		return [$stream, $id];
	}

	/** @return array{0: resource, 1: string} a stream that counts and checks what is written to it */
	public static function sink(): array {
		self::register();
		$id = bin2hex(random_bytes(8));
		self::$jobs[$id] = ['source' => false, 'total' => 0, 'pos' => 0, 'pool' => [], 'hash' => hash_init('xxh128')];
		$stream = fopen(self::SCHEME . '://' . $id, 'wb');
		if (!is_resource($stream)) {
			throw new \RuntimeException('The test data could not be started');
		}
		return [$stream, $id];
	}

	/** Bytes read from a source, or written to a sink, so far. */
	public static function position(string $id): int {
		return (int)(self::$jobs[$id]['pos'] ?? 0);
	}

	/** The checksum of everything that has passed. */
	public static function digest(string $id): string {
		return isset(self::$jobs[$id]) ? hash_final(hash_copy(self::$jobs[$id]['hash'])) : '';
	}

	public static function forget(string $id): void {
		unset(self::$jobs[$id]);
	}

	private static function register(): void {
		if (!in_array(self::SCHEME, stream_get_wrappers(), true)) {
			stream_wrapper_register(self::SCHEME, self::class);
		}
	}

	// ---- the stream wrapper itself

	public function stream_open(string $path, string $mode, int $options, ?string &$opened): bool {
		$this->id = substr($path, strlen(self::SCHEME . '://'));
		return isset(self::$jobs[$this->id]);
	}

	public function stream_read(int $count): string|false {
		$job = &self::$jobs[$this->id];
		$left = $job['total'] - $job['pos'];
		if (!$job['source'] || $left <= 0) {
			return '';
		}
		$offset = $job['pos'] % self::BLOCK;
		$n = min($count, $left, self::BLOCK - $offset);
		$block = $job['pool'][intdiv($job['pos'], self::BLOCK) % count($job['pool'])];
		$data = substr($block, $offset, $n);
		$job['pos'] += $n;
		hash_update($job['hash'], $data);
		return $data;
	}

	public function stream_write(string $data): int {
		$job = &self::$jobs[$this->id];
		$job['pos'] += strlen($data);
		hash_update($job['hash'], $data);
		return strlen($data);
	}

	public function stream_eof(): bool {
		$job = self::$jobs[$this->id];
		return $job['source'] && $job['pos'] >= $job['total'];
	}

	public function stream_tell(): int {
		return (int)self::$jobs[$this->id]['pos'];
	}

	/** @return array<string, int> */
	public function stream_stat(): array {
		$job = self::$jobs[$this->id];
		return ['size' => $job['source'] ? $job['total'] : $job['pos'], 'mode' => 0100644];
	}

	/** @return array<string, int>|false */
	public function url_stat(string $path, int $flags): array|false {
		$job = self::$jobs[substr($path, strlen(self::SCHEME . '://'))] ?? null;
		return $job === null ? false : ['size' => $job['source'] ? $job['total'] : $job['pos'], 'mode' => 0100644];
	}

	public function stream_flush(): bool {
		return true;
	}

	public function stream_close(): void {
	}

	public function stream_set_option(int $option, int $arg1, ?int $arg2): bool {
		return false;
	}
}
