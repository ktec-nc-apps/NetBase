<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\EndpointEntity;
use OCP\IConfig;

/**
 * Wake-on-LAN, sent the way the administrator chose.
 *
 * A device that is switched off answers nothing, so a magic packet has to come
 * from something that is awake on the same network segment. Where NetBase runs
 * on the LAN itself, that is this server, broadcasting. Where it does not —
 * Nextcloud AIO or any other container behind a bridge, or a server on another
 * subnet — the packet never reaches the wire, and something else on the LAN has
 * to send it. So there are three ways to send:
 *
 *  - broadcast: this server sends the packet to an address and port. The
 *    default, 255.255.255.255:9, is the usual broadcast; another address
 *    points it at a relay, or at a subnet's broadcast address.
 *  - command:   a command or script the administrator wrote runs on this
 *    server (curl to a router or Home Assistant, a relay of their own…).
 *  - ssh:       that command runs on a machine that is always on, through a
 *    saved SSH connection — a NAS, say, that has `wakeonlan` or `ether-wake`.
 *
 * The command is the administrator's and is trusted as such; what is put into
 * it is not, and only ever arrives checked: a MAC address in one fixed form and
 * an IPv4 address or nothing.
 */
class WakeService {
	public const METHODS = ['broadcast', 'command', 'ssh'];
	public const DEFAULT_ADDRESS = '255.255.255.255';
	public const DEFAULT_PORT = 9;
	/** How long a command may take before it is stopped. */
	private const COMMAND_TIMEOUT = 20.0;

	public function __construct(
		private IConfig $config,
		private ToolService $tools,
		private ExecService $exec,
		private SshService $ssh,
	) {
	}

	/**
	 * The administrator's choice, with the defaults filled in.
	 *
	 * @return array{method: string, address: string, port: int, command: string}
	 */
	public function settings(): array {
		$method = $this->config->getAppValue('netbase', 'wol_method', 'broadcast');
		$address = $this->config->getAppValue('netbase', 'wol_address', self::DEFAULT_ADDRESS);
		$port = (int)$this->config->getAppValue('netbase', 'wol_port', (string)self::DEFAULT_PORT);
		return [
			'method' => in_array($method, self::METHODS, true) ? $method : 'broadcast',
			'address' => filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false ? $address : self::DEFAULT_ADDRESS,
			'port' => $port >= 1 && $port <= 65535 ? $port : self::DEFAULT_PORT,
			'command' => $this->config->getAppValue('netbase', 'wol_command', ''),
		];
	}

	/**
	 * Store the administrator's choice. Anything malformed is refused rather
	 * than quietly replaced, so a mistyped address is noticed when it is saved,
	 * not when a machine fails to wake.
	 *
	 * @param array<string, mixed> $in
	 */
	public function save(array $in): void {
		if (isset($in['wolMethod'])) {
			$method = (string)$in['wolMethod'];
			if (!in_array($method, self::METHODS, true)) {
				throw new \InvalidArgumentException('Unknown way of sending Wake-on-LAN');
			}
			$this->config->setAppValue('netbase', 'wol_method', $method);
		}
		if (isset($in['wolAddress'])) {
			$address = trim((string)$in['wolAddress']);
			if ($address === '') {
				$address = self::DEFAULT_ADDRESS;
			}
			if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
				throw new \InvalidArgumentException('Enter an IPv4 address for Wake-on-LAN, such as 255.255.255.255 or 192.168.1.255.');
			}
			$this->config->setAppValue('netbase', 'wol_address', $address);
		}
		if (isset($in['wolPort'])) {
			$port = (int)$in['wolPort'];
			if ($port < 1 || $port > 65535) {
				throw new \InvalidArgumentException('The Wake-on-LAN port must be between 1 and 65535.');
			}
			$this->config->setAppValue('netbase', 'wol_port', (string)$port);
		}
		if (isset($in['wolCommand'])) {
			// One line: a script that needs more is a file, and its path is the command.
			$command = trim(str_replace(["\0", "\r", "\n"], ' ', (string)$in['wolCommand']));
			if (mb_strlen($command) > 2000) {
				throw new \InvalidArgumentException('That command is too long');
			}
			$this->config->setAppValue('netbase', 'wol_command', $command);
		}
	}

	/**
	 * A MAC address in the one form a command receives: six pairs of lower-case
	 * hex digits joined by colons. Null for anything else.
	 */
	public static function normalizeMac(string $mac): ?string {
		$mac = trim($mac);
		if (preg_match('/^[0-9A-Fa-f]{2}([:\-.]?)[0-9A-Fa-f]{2}(?:\1[0-9A-Fa-f]{2}){4}$/', $mac) !== 1
			&& preg_match('/^[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}$/', $mac) !== 1) {
			return null;
		}
		$hex = strtolower((string)preg_replace('/[^0-9A-Fa-f]/', '', $mac));
		if (strlen($hex) !== 12 || $hex === '000000000000' || $hex === 'ffffffffffff') {
			return null;
		}
		return implode(':', str_split($hex, 2));
	}

	/**
	 * The administrator's command with the device filled in.
	 *
	 *   {mac}  aa:bb:cc:dd:ee:ff     {MAC}  AA:BB:CC:DD:EE:FF
	 *   {ip}   the device's IPv4 address, or nothing when it has none
	 *
	 * Only checked values go in, and none of them can contain a character a
	 * shell would act on.
	 */
	public static function fill(string $template, string $mac, string $ip): string {
		$mac = self::normalizeMac($mac);
		if ($mac === null) {
			throw new \InvalidArgumentException('Not a MAC address');
		}
		if ($ip !== '' && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
			$ip = '';
		}
		return strtr($template, ['{mac}' => $mac, '{MAC}' => strtoupper($mac), '{ip}' => $ip]);
	}

	/**
	 * Send one wake-up.
	 *
	 * @param EndpointEntity|null $via the saved SSH connection, for the ssh method
	 * @return array<string, mixed>
	 */
	public function send(string $mac, string $ip = '', ?EndpointEntity $via = null): array {
		$norm = self::normalizeMac($mac);
		if ($norm === null) {
			throw new \InvalidArgumentException('Not a MAC address');
		}
		$s = $this->settings();
		if ($s['method'] === 'broadcast') {
			return ['method' => 'broadcast'] + $this->tools->wakeOnLan($norm, $s['address'], $s['port']);
		}
		if (trim($s['command']) === '') {
			throw new \InvalidArgumentException('No Wake-on-LAN command has been set. An administrator can set one in Administration settings → NetBase.');
		}
		$command = self::fill($s['command'], $norm, $ip);
		if ($s['method'] === 'command') {
			$run = $this->exec->run('sh', ['-c', $command], self::COMMAND_TIMEOUT, 65536);
			return [
				'method' => 'command',
				'sent' => $run['code'] === 0,
				'mac' => $norm,
				'exitStatus' => $run['code'],
				'output' => mb_substr(trim($run['stdout'] . "\n" . $run['stderr']), 0, 4000),
			];
		}
		if ($via === null) {
			throw new \InvalidArgumentException('Choose the saved SSH connection to send Wake-on-LAN through.');
		}
		$run = $this->ssh->run($via, $command, self::COMMAND_TIMEOUT);
		return [
			'method' => 'ssh',
			'sent' => ($run['exitStatus'] ?? 0) === 0,
			'mac' => $norm,
			'host' => $run['host'],
			'exitStatus' => $run['exitStatus'],
			'output' => mb_substr(trim((string)$run['output']), 0, 4000),
		];
	}
}
