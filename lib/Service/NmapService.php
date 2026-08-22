<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\IConfig;
use OCP\ITempManager;
use Psr\Log\LoggerInterface;

/**
 * Front end for nmap.
 *
 * The command line is never assembled from user text. The request names a
 * preset and a few structured knobs, and this class builds the argument list
 * itself; anything the user types as "extra options" must match the allow-list
 * below token for token, and file-writing or script-loading flags are refused
 * outright.
 */
class NmapService {
	/** Extra options a user may add, beyond what the presets already set. */
	private const ALLOWED_FLAGS = [
		'-Pn', '-n', '-R', '-sn', '-sT', '-sS', '-sU', '-sV', '-A', '-O', '-6',
		'-F', '-r', '-v', '-vv', '--open', '--reason', '--traceroute', '--badsum',
		'--osscan-guess', '--osscan-limit', '--version-light', '--version-all',
		'--defeat-rst-ratelimit', '--disable-arp-ping', '--send-ip', '--system-dns',
	];

	/** Options that take a value, with the pattern that value must match. */
	private const ALLOWED_VALUE_FLAGS = [
		'-p' => '/^[0-9,\-]{1,200}$|^-$/',
		'-T' => '/^[0-5]$/',
		'--top-ports' => '/^\d{1,5}$/',
		'--max-rtt-timeout' => '/^\d{1,5}m?s$/',
		'--host-timeout' => '/^\d{1,5}m?s?$/',
		'--min-rate' => '/^\d{1,6}$/',
		'--max-rate' => '/^\d{1,6}$/',
		'--min-parallelism' => '/^\d{1,4}$/',
		'--max-retries' => '/^\d{1,2}$/',
		'--script' => '/^[a-z0-9,\-*]{1,120}$/i',
		'--source-port' => '/^\d{1,5}$/',
	];

	/** @var array<string, array{label: string, args: list<string>, root: bool}> */
	public const PRESETS = [
		'discover' => ['label' => 'Host discovery (no port scan)', 'args' => ['-sn'], 'root' => false],
		'quick' => ['label' => 'Quick scan (100 common ports)', 'args' => ['-T4', '-F', '--open'], 'root' => false],
		'standard' => ['label' => 'Standard scan (1000 ports)', 'args' => ['-T4', '--open'], 'root' => false],
		'service' => ['label' => 'Service and version detection', 'args' => ['-T4', '-sV', '--version-light', '--open'], 'root' => false],
		'full' => ['label' => 'All 65535 TCP ports', 'args' => ['-T4', '-p-', '--open'], 'root' => false],
		'os' => ['label' => 'OS detection (needs root)', 'args' => ['-O', '--osscan-guess'], 'root' => true],
		'intense' => ['label' => 'Intense scan (-A, needs root)', 'args' => ['-T4', '-A'], 'root' => true],
		'udp' => ['label' => 'Top UDP ports (needs root)', 'args' => ['-sU', '--top-ports', '50'], 'root' => true],
		'vuln' => ['label' => 'Default NSE scripts', 'args' => ['-T4', '-sV', '--script', 'default'], 'root' => false],
	];

	public function __construct(
		private ExecService $exec,
		private ToolService $tools,
		private ITempManager $tempManager,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	public function status(): array {
		$path = $this->exec->which('nmap');
		$version = '';
		$privileged = false;
		if ($path !== null) {
			$result = $this->exec->run('nmap', ['--version'], 10.0);
			if (preg_match('/Nmap version (\S+)/', $result['stdout'], $m)) {
				$version = $m[1];
			}
			$privileged = $this->isPrivileged($path);
		}
		return [
			'available' => $path !== null,
			'path' => $path,
			'version' => $version,
			'privileged' => $privileged,
			'user' => function_exists('posix_getpwuid') && function_exists('posix_geteuid')
				? (posix_getpwuid(posix_geteuid())['name'] ?? '') : '',
			'presets' => self::PRESETS,
		];
	}

	/**
	 * Raw scan types need CAP_NET_RAW: either we are root, or the binary
	 * carries the capability itself.
	 */
	private function isPrivileged(string $path): bool {
		if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
			return true;
		}
		if ($this->exec->available('getcap')) {
			$result = $this->exec->run('getcap', [$path], 5.0);
			if (str_contains(strtolower($result['stdout']), 'cap_net_raw')) {
				return true;
			}
		}
		$perms = @fileperms($path);
		return $perms !== false && ($perms & 0x800) !== 0; // setuid bit
	}

	/**
	 * @param list<string> $targets
	 * @param list<string> $extra
	 */
	public function scan(array $targets, string $preset = 'quick', array $extra = [], float $timeout = 300.0): array {
		if (!isset(self::PRESETS[$preset])) {
			throw new \InvalidArgumentException('Unknown preset: ' . $preset);
		}
		$status = $this->status();
		if (!$status['available']) {
			return ['available' => false, 'error' => 'nmap is not installed on this server'];
		}
		if (self::PRESETS[$preset]['root'] && !$status['privileged']) {
			return ['available' => true, 'error' => 'This preset needs raw-socket privileges. Grant them with: sudo setcap cap_net_raw,cap_net_admin,cap_net_bind_service+eip ' . $status['path']];
		}

		$cleanTargets = [];
		foreach ($targets as $target) {
			$cleanTargets[] = $this->validateTarget((string)$target);
		}
		if ($cleanTargets === []) {
			throw new \InvalidArgumentException('No target given');
		}

		$xmlPath = $this->tempManager->getTemporaryFile('.xml');
		$args = array_merge(self::PRESETS[$preset]['args'], $this->validateExtra($extra), ['-oX', $xmlPath], $cleanTargets);
		$result = $this->exec->run('nmap', $args, $timeout, 8 * 1024 * 1024);

		$parsed = ['hosts' => []];
		if (is_readable($xmlPath)) {
			$parsed = $this->parseXml((string)file_get_contents($xmlPath));
			@unlink($xmlPath);
		}

		return [
			'available' => true,
			'preset' => $preset,
			'command' => 'nmap ' . implode(' ', $args),
			'seconds' => $result['seconds'],
			'output' => $result['stdout'],
			'error' => $result['ok'] ? null : trim($result['stderr']),
			'hosts' => $parsed['hosts'],
			'summary' => $parsed['summary'] ?? null,
		];
	}

	/** A target may be a host name, an address, a CIDR block or an a.b.c.d-e range. */
	public function validateTarget(string $target): string {
		$target = trim($target);
		if (preg_match('#^(\d{1,3}\.){3}\d{1,3}(/\d{1,2})?$#', $target)) {
			[$ip, $bits] = array_pad(explode('/', $target, 2), 2, '32');
			if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) && (int)$bits >= 8 && (int)$bits <= 32) {
				return $target;
			}
			throw new \InvalidArgumentException('Invalid network: ' . $target);
		}
		if (preg_match('#^(\d{1,3}\.){3}\d{1,3}-\d{1,3}$#', $target)) {
			return $target;
		}
		if (filter_var($target, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
			return $target;
		}
		return $this->tools->validateHost($target);
	}

	/**
	 * @param list<string> $extra
	 * @return list<string>
	 */
	private function validateExtra(array $extra): array {
		$out = [];
		$tokens = [];
		foreach ($extra as $entry) {
			foreach (preg_split('/\s+/', trim((string)$entry)) ?: [] as $token) {
				if ($token !== '') {
					$tokens[] = $token;
				}
			}
		}
		for ($i = 0; $i < count($tokens); $i++) {
			$token = $tokens[$i];
			// Reject anything that writes files, reads target lists or loads
			// scripts from disk, however it is spelled.
			if (preg_match('#^-(o[ANGSX]|iL|iR|-resume|-script-args-file|-datadir|-servicedb|-versiondb|-stylesheet)#i', $token)) {
				throw new \InvalidArgumentException('Option not allowed: ' . $token);
			}
			if (str_contains($token, '=')) {
				[$flag, $value] = explode('=', $token, 2);
				if (isset(self::ALLOWED_VALUE_FLAGS[$flag]) && preg_match(self::ALLOWED_VALUE_FLAGS[$flag], $value)) {
					$out[] = $flag;
					$out[] = $value;
					continue;
				}
				throw new \InvalidArgumentException('Option not allowed: ' . $token);
			}
			if (in_array($token, self::ALLOWED_FLAGS, true)) {
				$out[] = $token;
				continue;
			}
			if (preg_match('/^-T[0-5]$/', $token) || preg_match('/^-p[0-9,\-]+$/', $token)) {
				$out[] = $token;
				continue;
			}
			if (isset(self::ALLOWED_VALUE_FLAGS[$token])) {
				$value = $tokens[$i + 1] ?? '';
				if (!preg_match(self::ALLOWED_VALUE_FLAGS[$token], $value)) {
					throw new \InvalidArgumentException('Invalid value for ' . $token . ': ' . $value);
				}
				$out[] = $token;
				$out[] = $value;
				$i++;
				continue;
			}
			throw new \InvalidArgumentException('Option not allowed: ' . $token);
		}
		return $out;
	}

	private function parseXml(string $xml): array {
		$previous = libxml_use_internal_errors(true);
		$doc = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NONET | LIBXML_NOENT);
		libxml_use_internal_errors($previous);
		if ($doc === false) {
			return ['hosts' => []];
		}

		$hosts = [];
		foreach ($doc->host ?? [] as $host) {
			$addresses = [];
			$mac = null;
			$vendor = null;
			foreach ($host->address ?? [] as $address) {
				$type = (string)$address['addrtype'];
				if ($type === 'mac') {
					$mac = strtolower((string)$address['addr']);
					$vendor = (string)$address['vendor'] ?: null;
				} else {
					$addresses[] = (string)$address['addr'];
				}
			}
			$names = [];
			foreach ($host->hostnames->hostname ?? [] as $hostname) {
				$names[] = (string)$hostname['name'];
			}
			$ports = [];
			foreach ($host->ports->port ?? [] as $port) {
				$ports[] = [
					'port' => (int)$port['portid'],
					'protocol' => (string)$port['protocol'],
					'state' => (string)($port->state['state'] ?? ''),
					'reason' => (string)($port->state['reason'] ?? ''),
					'service' => (string)($port->service['name'] ?? ''),
					'product' => trim((string)($port->service['product'] ?? '') . ' ' . (string)($port->service['version'] ?? '')),
				];
			}
			$os = [];
			foreach ($host->os->osmatch ?? [] as $match) {
				$os[] = ['name' => (string)$match['name'], 'accuracy' => (int)$match['accuracy']];
			}
			$hosts[] = [
				'state' => (string)($host->status['state'] ?? ''),
				'addresses' => $addresses,
				'mac' => $mac,
				'vendor' => $vendor,
				'hostnames' => $names,
				'ports' => $ports,
				'os' => $os,
			];
		}

		$summary = null;
		if (isset($doc->runstats->finished)) {
			$summary = (string)$doc->runstats->finished['summary'];
		}
		return ['hosts' => $hosts, 'summary' => $summary];
	}
}
