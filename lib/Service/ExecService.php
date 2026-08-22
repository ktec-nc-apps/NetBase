<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use Psr\Log\LoggerInterface;

/**
 * Runs external binaries safely.
 *
 * Every argument is passed as an array element, so nothing is ever handed to a
 * shell — a target such as `example.com; rm -rf /` reaches the binary as one
 * literal argument and simply fails to resolve.
 */
class ExecService {
	public function __construct(
		private LoggerInterface $logger,
	) {
	}

	/** Absolute path of a binary, or null when it is not installed. */
	public function which(string $binary): ?string {
		if (!preg_match('/^[a-z0-9_-]+$/i', $binary)) {
			return null;
		}
		foreach (['/usr/bin/', '/bin/', '/usr/sbin/', '/sbin/', '/usr/local/bin/', '/usr/local/sbin/', '/opt/homebrew/bin/'] as $dir) {
			if (is_executable($dir . $binary)) {
				return $dir . $binary;
			}
		}
		return null;
	}

	public function available(string $binary): bool {
		return $this->which($binary) !== null;
	}

	/**
	 * @param list<string> $args
	 * @return array{ok: bool, code: int, stdout: string, stderr: string, seconds: float, command: string}
	 */
	/** @param array<string, string> $extraEnv extra environment for this run */
	public function run(string $binary, array $args, float $timeout = 20.0, int $maxOutput = 1048576, array $extraEnv = []): array {
		$path = $this->which($binary);
		$started = microtime(true);
		if ($path === null) {
			return ['ok' => false, 'code' => 127, 'stdout' => '', 'stderr' => $binary . ' is not installed on this server', 'seconds' => 0.0, 'command' => $binary];
		}
		if (!function_exists('proc_open')) {
			return ['ok' => false, 'code' => 126, 'stdout' => '', 'stderr' => 'proc_open() is disabled in this PHP configuration', 'seconds' => 0.0, 'command' => $binary];
		}

		$descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
		$env = array_merge(['PATH' => '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL' => 'C'], $extraEnv);
		$process = @proc_open(array_merge([$path], array_values($args)), $descriptors, $pipes, null, $env);
		if (!is_resource($process)) {
			return ['ok' => false, 'code' => 126, 'stdout' => '', 'stderr' => 'Could not start ' . $binary, 'seconds' => 0.0, 'command' => $binary];
		}

		stream_set_blocking($pipes[1], false);
		stream_set_blocking($pipes[2], false);
		$stdout = '';
		$stderr = '';
		$deadline = microtime(true) + $timeout;
		$timedOut = false;

		while (true) {
			$status = proc_get_status($process);
			$read = [$pipes[1], $pipes[2]];
			$write = null;
			$except = null;
			if (@stream_select($read, $write, $except, 0, 100000) > 0) {
				foreach ($read as $pipe) {
					$data = fread($pipe, 65536);
					if ($data === false || $data === '') {
						continue;
					}
					if ($pipe === $pipes[1]) {
						$stdout .= $data;
					} else {
						$stderr .= $data;
					}
				}
			}
			if (strlen($stdout) + strlen($stderr) > $maxOutput) {
				$stderr .= "\n[output truncated]";
				proc_terminate($process, 9);
				break;
			}
			if (!$status['running']) {
				$stdout .= (string)stream_get_contents($pipes[1]);
				$stderr .= (string)stream_get_contents($pipes[2]);
				break;
			}
			if (microtime(true) > $deadline) {
				$timedOut = true;
				proc_terminate($process, 9);
				break;
			}
		}

		foreach ($pipes as $pipe) {
			@fclose($pipe);
		}
		$code = proc_close($process);
		if ($timedOut) {
			$stderr .= "\n[timed out after " . $timeout . 's]';
		}

		return [
			'ok' => !$timedOut && $code === 0,
			'code' => $code,
			'stdout' => $stdout,
			'stderr' => $stderr,
			'seconds' => round(microtime(true) - $started, 3),
			'command' => $binary . ' ' . implode(' ', $args),
		];
	}
}
