<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Vendor\phpseclib3\Common\Functions\Strings;
use OCA\NetBase\Vendor\phpseclib3\Net\SSH2;

/**
 * phpseclib's SSH client, able to send environment variables with a shell.
 *
 * OpenSSH's client sends them ("SendEnv") between asking for a terminal and
 * starting the shell; phpseclib has no way to. This does the same at that
 * same moment. A server accepts only the names its sshd_config lists under
 * AcceptEnv (on Debian and Ubuntu: LANG and LC_*), and silently ignores the
 * rest, so the request asks for no reply.
 *
 * phpseclib keeps the terminal type and the window size to itself, so the
 * shell is opened from inside its own class scope, the steps of openShell()
 * repeated with the variables put in between. Without variables the library's
 * own openShell() runs untouched.
 */
final class TermSsh extends SSH2 {
	/** @var array<string, string> */
	private array $environment = [];

	/** @param array<string, string> $environment */
	public function setEnvironment(array $environment): void {
		$this->environment = $environment;
	}

	public function openShell() {
		if ($this->environment === []) {
			return parent::openShell();
		}
		$environment = $this->environment;
		$open = \Closure::bind(function () use ($environment) {
			if (!$this->isAuthenticated()) {
				throw new \RuntimeException('Operation disallowed prior to login()');
			}
			$this->open_channel(self::CHANNEL_SHELL);

			$this->send_binary_packet(Strings::packSSH2(
				'CNsbsN4s',
				NET_SSH2_MSG_CHANNEL_REQUEST,
				$this->server_channels[self::CHANNEL_SHELL],
				'pty-req',
				true,
				$this->term,
				$this->windowColumns,
				$this->windowRows,
				0,
				0,
				pack('C', NET_SSH2_TTY_OP_END)
			));
			$this->channel_status[self::CHANNEL_SHELL] = NET_SSH2_MSG_CHANNEL_REQUEST;
			if (!$this->get_channel_packet(self::CHANNEL_SHELL)) {
				throw new \RuntimeException('Unable to request pty');
			}

			foreach ($environment as $name => $value) {
				$this->send_binary_packet(Strings::packSSH2(
					'CNsbss',
					NET_SSH2_MSG_CHANNEL_REQUEST,
					$this->server_channels[self::CHANNEL_SHELL],
					'env',
					false,
					(string)$name,
					(string)$value
				));
			}

			$this->send_binary_packet(Strings::packSSH2(
				'CNsb',
				NET_SSH2_MSG_CHANNEL_REQUEST,
				$this->server_channels[self::CHANNEL_SHELL],
				'shell',
				true
			));
			if ($this->get_channel_packet(self::CHANNEL_SHELL) === false) {
				throw new \RuntimeException('Unable to request shell');
			}
			$this->channel_status[self::CHANNEL_SHELL] = NET_SSH2_MSG_CHANNEL_DATA;
			$this->channel_id_last_interactive = self::CHANNEL_SHELL;
			$this->bitmap |= self::MASK_SHELL;
			return true;
		}, $this, SSH2::class);
		return $open();
	}
}
