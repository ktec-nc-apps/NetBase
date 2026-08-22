<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\IConfig;
use OCP\IGroupManager;
use OCP\IUserSession;

/**
 * Per-tool access control.
 *
 * Each tool is set to one of three levels: administrators only, the groups
 * named in the app settings, or every signed-in user. Probing tools default to
 * administrators; lookups that touch nothing on the local network default to
 * everyone, because they are no more powerful than a public web form.
 */
class PermissionService {
	public const ADMIN = 'admin';
	public const GROUPS = 'groups';
	public const ALL = 'all';
	public const LEVELS = [self::ADMIN, self::GROUPS, self::ALL];

	/**
	 * Every tool, with the level it ships with.
	 *
	 * @var array<string, array{default: string, label: string, probes: bool}>
	 */
	public const TOOLS = [
		'devices' => ['default' => self::ALL, 'label' => 'Devices — read the device list', 'probes' => false],
		'scan' => ['default' => self::ADMIN, 'label' => 'Scanning — sweep the network and edit the device list', 'probes' => true],
		'nmap' => ['default' => self::ADMIN, 'label' => 'nmap — presets over the nmap scanner', 'probes' => true],
		'ports' => ['default' => self::ADMIN, 'label' => 'Ports — TCP connect check with banners', 'probes' => true],
		'ping' => ['default' => self::ALL, 'label' => 'Ping and traceroute', 'probes' => true],
		'wol' => ['default' => self::ADMIN, 'label' => 'Wake-on-LAN — send magic packets', 'probes' => true],
		'server' => ['default' => self::ADMIN, 'label' => 'This server — interfaces, routes, listening sockets', 'probes' => false],
		'bench' => ['default' => self::ADMIN, 'label' => 'Benchmarks — speed test, throughput, DNS and HTTP timing', 'probes' => true],
		'dns' => ['default' => self::ALL, 'label' => 'DNS — records, SPF and DMARC', 'probes' => false],
		'whois' => ['default' => self::ALL, 'label' => 'Whois — domain and address registration', 'probes' => false],
		'tls' => ['default' => self::ALL, 'label' => 'TLS and HTTP — certificates and headers', 'probes' => false],
		'subnet' => ['default' => self::ALL, 'label' => 'Subnet calculator and MAC vendor lookup', 'probes' => false],
		'mail' => ['default' => self::ADMIN, 'label' => 'Mail — domain policy audit, server tests and test messages', 'probes' => true],
		'files' => ['default' => self::ADMIN, 'label' => 'FTP and SFTP — browse remote servers and move files', 'probes' => true],
		'ssh' => ['default' => self::ALL, 'label' => 'SSH, Telnet and NTP — service probes without signing in', 'probes' => true],
		'sshexec' => ['default' => self::ADMIN, 'label' => 'SSH commands — run commands on a saved connection', 'probes' => true],
	];

	public function __construct(
		private IUserSession $userSession,
		private IGroupManager $groupManager,
		private IConfig $config,
	) {
	}

	public function uid(): ?string {
		return $this->userSession->getUser()?->getUID();
	}

	public function isAdmin(): bool {
		$uid = $this->uid();
		return $uid !== null && $this->groupManager->isAdmin($uid);
	}

	/**
	 * The configured level of every tool, defaults filled in.
	 *
	 * @return array<string, string>
	 */
	public function levels(): array {
		$stored = json_decode($this->config->getAppValue('netbase', 'tool_access', '') ?: '[]', true);
		$stored = is_array($stored) ? $stored : [];
		$levels = [];
		foreach (self::TOOLS as $tool => $meta) {
			$level = (string)($stored[$tool] ?? $meta['default']);
			$levels[$tool] = in_array($level, self::LEVELS, true) ? $level : $meta['default'];
		}
		return $levels;
	}

	/** @param array<string, string> $levels */
	public function setLevels(array $levels): void {
		$current = $this->levels();
		foreach ($levels as $tool => $level) {
			if (isset(self::TOOLS[$tool]) && in_array($level, self::LEVELS, true)) {
				$current[$tool] = $level;
			}
		}
		$this->config->setAppValue('netbase', 'tool_access', (string)json_encode($current));
	}

	/** Groups granted the tools set to the "groups" level. */
	public function groups(): string {
		return $this->config->getAppValue('netbase', 'tool_groups', '');
	}

	public function setGroups(string $groups): void {
		$this->config->setAppValue('netbase', 'tool_groups', mb_substr($groups, 0, 1024));
	}

	/** Whether users with no permitted tool see NetBase in the app menu. */
	public function hidesEmptyMenu(): bool {
		return $this->config->getAppValue('netbase', 'hide_empty_menu', 'yes') === 'yes';
	}

	public function setHidesEmptyMenu(bool $hide): void {
		$this->config->setAppValue('netbase', 'hide_empty_menu', $hide ? 'yes' : 'no');
	}

	public function can(string $tool): bool {
		if (!isset(self::TOOLS[$tool])) {
			return false;
		}
		if ($this->isAdmin()) {
			return true;
		}
		$uid = $this->uid();
		if ($uid === null) {
			return false;
		}
		return match ($this->levels()[$tool]) {
			self::ALL => true,
			self::GROUPS => $this->inConfiguredGroup($uid),
			default => false,
		};
	}

	/** @return array<string, bool> */
	public function permissions(): array {
		$out = [];
		foreach (array_keys(self::TOOLS) as $tool) {
			$out[$tool] = $this->can($tool);
		}
		return $out;
	}

	/** True when this user may use nothing at all. */
	public function canUseAnything(): bool {
		foreach (array_keys(self::TOOLS) as $tool) {
			if ($this->can($tool)) {
				return true;
			}
		}
		return false;
	}

	public function require(string $tool): void {
		if (!$this->can($tool)) {
			throw new \RuntimeException('This tool is not available to your account on this instance');
		}
	}

	public function requireAdmin(): void {
		if (!$this->isAdmin()) {
			throw new \RuntimeException('Administrator rights are required');
		}
	}

	private function inConfiguredGroup(string $uid): bool {
		foreach (array_filter(array_map('trim', explode(',', $this->groups()))) as $group) {
			if ($this->groupManager->isInGroup($uid, $group)) {
				return true;
			}
		}
		return false;
	}
}
