<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/**
 * What NetBase can use, whether it is here, and exactly how to install it.
 *
 * Nothing in this list is required to run the app — every entry buys one
 * specific capability, and the interface says which. The install commands are
 * generated for the package manager this machine actually has, because "install
 * nmap" is not useful guidance on a system where the answer is `apk add nmap`.
 */
class RequirementsService {
	private const PACKAGE_MANAGERS = [
		'apt-get' => ['label' => 'Debian / Ubuntu', 'install' => 'sudo apt install %s'],
		'dnf' => ['label' => 'Fedora / RHEL 8+', 'install' => 'sudo dnf install %s'],
		'yum' => ['label' => 'RHEL / CentOS 7', 'install' => 'sudo yum install %s'],
		'zypper' => ['label' => 'openSUSE', 'install' => 'sudo zypper install %s'],
		'pacman' => ['label' => 'Arch Linux', 'install' => 'sudo pacman -S %s'],
		'apk' => ['label' => 'Alpine Linux', 'install' => 'apk add %s'],
		'brew' => ['label' => 'macOS (Homebrew)', 'install' => 'brew install %s'],
	];

	public function __construct(
		private ExecService $exec,
		private DiscoveryService $discovery,
	) {
	}

	/**
	 * What is installed and what each missing piece would buy.
	 *
	 * Ordinary users see which capabilities exist and which are dormant, so
	 * they know what to ask an administrator for. What the machine runs, and
	 * the commands to change it, are for administrators only.
	 */
	public function report(bool $full = true): array {
		$report = $this->fullReport();
		if ($full) {
			return $report;
		}
		foreach ($report['components'] as $index => $component) {
			unset($component['install'], $component['allInstall'], $component['after'], $component['packages']);
			$report['components'][$index] = $component;
		}
		return [
			'distro' => null,
			'packageManager' => null,
			'packageManagerLabel' => null,
			'phpVersion' => null,
			'phpUser' => null,
			'neighbourLimits' => null,
			'components' => $report['components'],
		];
	}

	/**
	 * @return array{distro: string, packageManager: ?string, packageManagerLabel: ?string, phpVersion: string, components: list<array>}
	 */
	private function fullReport(): array {
		$manager = $this->detectPackageManager();
		$distro = $this->detectDistro();

		$components = [];
		foreach ($this->components() as $component) {
			// A binary probe may name alternatives ("chromium|google-chrome"):
			// any one of them counts as present.
			$component['present'] = $component['kind'] === 'php'
				? extension_loaded($component['probe'])
				: (bool)array_filter(explode('|', $component['probe']), fn (string $binary) => $this->exec->available($binary));
			$component['install'] = $this->installCommand($component, $manager);
			$component['allInstall'] = $this->allInstallCommands($component);
			$components[] = $component;
		}

		return [
			'distro' => $distro,
			'packageManager' => $manager,
			'packageManagerLabel' => $manager !== null ? self::PACKAGE_MANAGERS[$manager]['label'] : null,
			'phpVersion' => PHP_VERSION,
			'phpUser' => function_exists('posix_getpwuid') && function_exists('posix_geteuid')
				? (posix_getpwuid(posix_geteuid())['name'] ?? '') : '',
			'neighbourLimits' => $this->discovery->neighbourLimits(),
			'components' => $components,
		];
	}

	/** @return list<array> */
	private function components(): array {
		return [
			[
				'id' => 'ext-sockets',
				'kind' => 'php',
				'probe' => 'sockets',
				'name' => 'PHP sockets extension',
				'enables' => 'Multicast discovery (WS-Discovery and SSDP) and Wake-on-LAN',
				'without' => 'Devices are still found and named over NetBIOS, mDNS and reverse DNS; only multicast discovery and Wake-on-LAN are unavailable.',
				'packages' => ['apt-get' => 'php-sockets', 'dnf' => 'php-sockets', 'yum' => 'php-sockets', 'zypper' => 'php-sockets', 'pacman' => 'php', 'apk' => 'php-sockets', 'brew' => 'php'],
				'after' => 'Restart PHP-FPM afterwards, for example: sudo systemctl restart php*-fpm',
			],
			[
				'id' => 'ext-curl',
				'kind' => 'php',
				'probe' => 'curl',
				'name' => 'PHP cURL extension',
				'enables' => 'Internet speed test and the HTTP timing breakdown',
				'without' => 'The speed test and HTTP timing cannot run. Everything else is unaffected.',
				'packages' => ['apt-get' => 'php-curl', 'dnf' => 'php-curl', 'yum' => 'php-curl', 'zypper' => 'php-curl', 'pacman' => 'php', 'apk' => 'php-curl', 'brew' => 'php'],
				'after' => 'Restart PHP-FPM afterwards, for example: sudo systemctl restart php*-fpm',
			],
			[
				'id' => 'ext-ftp',
				'kind' => 'php',
				'probe' => 'ftp',
				'name' => 'PHP FTP extension',
				'enables' => 'Browsing FTP servers and moving files to and from your Nextcloud files',
				'without' => 'SFTP still works — it uses the library Nextcloud already ships — but plain FTP servers cannot be opened.',
				'packages' => ['apt-get' => 'php-ftp', 'dnf' => 'php-ftp', 'yum' => 'php-ftp', 'zypper' => 'php-ftp', 'pacman' => 'php', 'apk' => 'php-ftp', 'brew' => 'php'],
				'after' => 'Restart PHP-FPM afterwards, for example: sudo systemctl restart php*-fpm',
			],
			[
				'id' => 'iperf3',
				'kind' => 'binary',
				'probe' => 'iperf3',
				'name' => 'iperf3',
				'enables' => 'LAN throughput measurement between this server and another machine',
				'without' => 'Local link speed cannot be measured. An internet speed test measures the internet, not the LAN.',
				'packages' => ['apt-get' => 'iperf3', 'dnf' => 'iperf3', 'yum' => 'iperf3', 'zypper' => 'iperf3', 'pacman' => 'iperf3', 'apk' => 'iperf3', 'brew' => 'iperf3'],
				'after' => 'The other machine has to run a server: iperf3 -s',
			],
			[
				'id' => 'chromium',
				'kind' => 'binary',
				'probe' => 'chromium|chromium-browser|google-chrome|google-chrome-stable',
				'name' => 'Headless Chromium',
				'enables' => 'Showing a device\'s own web page as a picture, rendered on this server',
				'without' => 'The web ports of a device are still offered as links to open in your browser.',
				'packages' => ['apt-get' => 'chromium-browser', 'dnf' => 'chromium', 'yum' => 'chromium', 'zypper' => 'chromium', 'pacman' => 'chromium', 'apk' => 'chromium', 'brew' => 'chromium'],
				'after' => 'It is a large package. NetBase runs it with a throwaway profile and deletes it after every page.',
			],
			[
				'id' => 'nmap',
				'kind' => 'binary',
				'probe' => 'nmap',
				'name' => 'nmap',
				'enables' => 'The nmap tab: host discovery, port and service detection with presets',
				'without' => 'NetBase still sweeps the LAN and checks common ports on its own; the nmap tab is hidden.',
				'packages' => ['apt-get' => 'nmap', 'dnf' => 'nmap', 'yum' => 'nmap', 'zypper' => 'nmap', 'pacman' => 'nmap', 'apk' => 'nmap', 'brew' => 'nmap'],
				'after' => 'SYN, OS and UDP scans additionally need raw sockets: sudo setcap cap_net_raw,cap_net_admin,cap_net_bind_service+eip $(command -v nmap)',
			],
			[
				'id' => 'mtr',
				'kind' => 'binary',
				'probe' => 'mtr',
				'name' => 'mtr',
				'enables' => 'Path quality: per-hop packet loss and latency along a route',
				'without' => 'Traceroute still shows the path; per-hop loss statistics are unavailable.',
				'packages' => ['apt-get' => 'mtr-tiny', 'dnf' => 'mtr', 'yum' => 'mtr', 'zypper' => 'mtr', 'pacman' => 'mtr', 'apk' => 'mtr', 'brew' => 'mtr'],
				'after' => 'Unprivileged use needs raw sockets: sudo setcap cap_net_raw+ep $(command -v mtr)',
			],
			[
				'id' => 'traceroute',
				'kind' => 'binary',
				'probe' => 'traceroute',
				'name' => 'traceroute',
				'enables' => 'Tracing the path to a host',
				'without' => 'NetBase falls back to tracepath if it is installed; otherwise path tracing is unavailable.',
				'packages' => ['apt-get' => 'traceroute', 'dnf' => 'traceroute', 'yum' => 'traceroute', 'zypper' => 'traceroute', 'pacman' => 'traceroute', 'apk' => 'traceroute', 'brew' => 'traceroute'],
				'after' => null,
			],
			[
				'id' => 'ping',
				'kind' => 'binary',
				'probe' => 'ping',
				'name' => 'ping',
				'enables' => 'Reachability and round-trip time',
				'without' => 'Reachability can still be inferred from the TCP port check, without round-trip times.',
				'packages' => ['apt-get' => 'iputils-ping', 'dnf' => 'iputils', 'yum' => 'iputils', 'zypper' => 'iputils', 'pacman' => 'iputils', 'apk' => 'iputils', 'brew' => null],
				'after' => null,
			],
			[
				'id' => 'ss',
				'kind' => 'binary',
				'probe' => 'ss',
				'name' => 'ss (iproute2)',
				'enables' => 'The listening-sockets list under “This server”',
				'without' => 'NetBase falls back to netstat; without either, the socket list is empty.',
				'packages' => ['apt-get' => 'iproute2', 'dnf' => 'iproute', 'yum' => 'iproute', 'zypper' => 'iproute2', 'pacman' => 'iproute2', 'apk' => 'iproute2', 'brew' => null],
				'after' => null,
			],
		];
	}

	private function installCommand(array $component, ?string $manager): ?string {
		if ($manager === null) {
			return null;
		}
		$package = $component['packages'][$manager] ?? null;
		if ($package === null) {
			return null;
		}
		return sprintf(self::PACKAGE_MANAGERS[$manager]['install'], $package);
	}

	/** Every distribution's command, so the panel is useful when read remotely. */
	private function allInstallCommands(array $component): array {
		$out = [];
		foreach (self::PACKAGE_MANAGERS as $manager => $meta) {
			$package = $component['packages'][$manager] ?? null;
			if ($package !== null) {
				$out[] = ['label' => $meta['label'], 'command' => sprintf($meta['install'], $package)];
			}
		}
		return $out;
	}

	private function detectPackageManager(): ?string {
		foreach (array_keys(self::PACKAGE_MANAGERS) as $manager) {
			if ($this->exec->available($manager)) {
				return $manager;
			}
		}
		return null;
	}

	private function detectDistro(): string {
		$release = @file_get_contents('/etc/os-release');
		if (is_string($release) && preg_match('/^PRETTY_NAME="?([^"\n]+)"?/m', $release, $m)) {
			return trim($m[1]);
		}
		return PHP_OS_FAMILY;
	}
}
