<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\EndpointEntity;
use Psr\Log\LoggerInterface;

/**
 * Signed-in SSH: run a command on a saved connection and read the result.
 *
 * This is the maintenance half of the SSH tools — the probe half asks a server
 * what it offers without credentials. Authentication is by password or private
 * key, both kept encrypted in the saved connection, and the library is the
 * phpseclib copy Nextcloud already ships.
 *
 * There is no terminal here on purpose. PHP-FPM ends every request, so a shell
 * session cannot outlive one; what is useful and honest instead is a command
 * that runs, finishes and returns its output.
 */
class SshService {
	/** The questions people actually run on a server they are checking. */
	public const PRESETS = [
		'snapshot' => [
			'label' => 'System snapshot',
			'command' => 'uname -a; echo; uptime; echo; free -h 2>/dev/null | head -3; echo; df -h -x tmpfs -x devtmpfs 2>/dev/null | head -12',
		],
		'disk' => [
			'label' => 'Disk usage',
			'command' => 'df -h -x tmpfs -x devtmpfs; echo; du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -12',
		],
		'services' => [
			'label' => 'Failed services and recent errors',
			'command' => 'systemctl --failed --no-pager 2>/dev/null; echo; journalctl -p 3 -n 20 --no-pager 2>/dev/null',
		],
		'network' => [
			'label' => 'Network configuration',
			'command' => 'ip -br a 2>/dev/null || ifconfig -a; echo; ip r 2>/dev/null || netstat -rn; echo; cat /etc/resolv.conf 2>/dev/null | grep -v "^#"',
		],
		'listeners' => [
			'label' => 'Listening sockets',
			'command' => 'ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null',
		],
		'updates' => [
			'label' => 'Pending updates',
			'command' => 'if command -v apt-get >/dev/null; then apt-get -s -q upgrade 2>/dev/null | grep -E "^[0-9]+ upgraded" ; apt list --upgradable 2>/dev/null | head -20; elif command -v dnf >/dev/null; then dnf -q check-update | head -20; fi',
		],
		'logins' => [
			'label' => 'Who is logged in, and who failed',
			'command' => 'who; echo; last -n 10 2>/dev/null; echo; lastb -n 10 2>/dev/null | head -12',
		],
	];

	private const TIMEOUT = 30;

	public function __construct(
		private EndpointService $endpoints,
		private L10nService $l,
		private LoggerInterface $logger,
	) {
	}

	public function available(): bool {
		return ProbeService::ssh2Class() !== null;
	}

	/**
	 * Run one command over SSH and return what it printed.
	 *
	 * @return array<string, mixed>
	 */
	public function run(EndpointEntity $endpoint, string $command, float $timeout = self::TIMEOUT): array {
		$kind = (string)$endpoint->getKind();
		if (!in_array($kind, ['ssh', 'sftp'], true)) {
			throw new \InvalidArgumentException('That saved connection is not an SSH connection');
		}
		$command = trim($command);
		if ($command === '') {
			throw new \InvalidArgumentException('No command given');
		}
		if (strlen($command) > 4000) {
			throw new \InvalidArgumentException('That command is too long');
		}

		$class = ProbeService::ssh2Class();
		if ($class === null) {
			throw new \RuntimeException('No SSH library is available on this server');
		}

		$host = (string)$endpoint->getHost();
		$port = (int)$endpoint->getPort() ?: 22;
		$user = (string)$endpoint->getUsername();
		$credentials = $this->endpoints->credentials($endpoint);
		$secret = $credentials['key'] !== ''
			? TransferService::loadPrivateKey($credentials['key'], $credentials['passphrase'])
			: $credentials['password'];

		$started = microtime(true);
		$ssh = new $class($host, $port, (int)$timeout);
		if (method_exists($ssh, 'setTimeout')) {
			$ssh->setTimeout($timeout);
		}
		if (!@$ssh->login($user, $secret)) {
			$this->endpoints->touch($endpoint, 'Sign-in refused');
			throw new \RuntimeException($this->l->t('Sign-in was refused for %s@%s. Check the user name and the password or key.', [$user, $host]));
		}

		$output = (string)@$ssh->exec($command);
		$status = method_exists($ssh, 'getExitStatus') ? $ssh->getExitStatus() : null;
		$banner = method_exists($ssh, 'getServerIdentification') ? (string)$ssh->getServerIdentification() : null;
		if (method_exists($ssh, 'disconnect')) {
			@$ssh->disconnect();
		}

		$this->endpoints->touch($endpoint, 'Ran a command');
		return [
			'host' => $host,
			'user' => $user,
			'command' => $command,
			'output' => mb_substr($this->clean($output), 0, 200000),
			'exitStatus' => is_int($status) ? $status : null,
			'banner' => $banner,
			'seconds' => round(microtime(true) - $started, 3),
			'truncated' => strlen($output) > 200000,
		];
	}

	/**
	 * Run one of the presets — the same thing, with the command written for you.
	 *
	 * @return array<string, mixed>
	 */
	public function preset(EndpointEntity $endpoint, string $preset): array {
		if (!isset(self::PRESETS[$preset])) {
			throw new \InvalidArgumentException('Unknown preset');
		}
		$result = $this->run($endpoint, self::PRESETS[$preset]['command']);
		$result['preset'] = $preset;
		$result['label'] = self::PRESETS[$preset]['label'];
		return $result;
	}

	/** Terminal control sequences make the output unreadable in a browser. */
	private function clean(string $text): string {
		$text = preg_replace('/\x1b\[[0-9;?]*[a-zA-Z]/', '', $text) ?? $text;
		return preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', '', $text) ?? $text;
	}
}
