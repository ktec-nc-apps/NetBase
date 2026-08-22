<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\EndpointEntity;
use OCA\NetBase\Db\EndpointMapper;
use OCP\Security\ICrypto;
use Psr\Log\LoggerInterface;

/**
 * Saved connections — the FTP / SFTP / mail servers a user works with.
 *
 * Passwords are encrypted with ICrypto (the instance secret) before they reach
 * the database and are decrypted only for the duration of one connection. They
 * are never sent to the browser: the API reports `hasSecret`, nothing more.
 */
class EndpointService {
	/** kind => [default port, encryption modes, label] */
	public const KINDS = [
		'ftp' => ['port' => 21, 'modes' => ['none', 'starttls', 'tls'], 'label' => 'FTP'],
		'sftp' => ['port' => 22, 'modes' => ['ssh'], 'label' => 'SFTP (over SSH)'],
		'smtp' => ['port' => 587, 'modes' => ['starttls', 'tls', 'none'], 'label' => 'SMTP (sending)'],
		'imap' => ['port' => 993, 'modes' => ['tls', 'starttls', 'none'], 'label' => 'IMAP (mailbox)'],
		'pop3' => ['port' => 995, 'modes' => ['tls', 'starttls', 'none'], 'label' => 'POP3 (mailbox)'],
		'ssh' => ['port' => 22, 'modes' => ['ssh'], 'label' => 'SSH'],
	];

	public function __construct(
		private EndpointMapper $mapper,
		private ICrypto $crypto,
		private ToolService $tools,
		private LoggerInterface $logger,
	) {
	}

	/** @return array<int, array<string, mixed>> */
	public function list(string $userId): array {
		return array_map(static fn (EndpointEntity $e) => $e->jsonSerialize(), $this->mapper->findForUser($userId));
	}

	public function get(int $id, string $userId): EndpointEntity {
		$row = $this->mapper->findOwned($id, $userId);
		if ($row === null) {
			throw new \RuntimeException('No such saved connection');
		}
		return $row;
	}

	/**
	 * The stored credentials, decrypted for one connection.
	 *
	 * One encrypted blob holds all of them, so a private key and its passphrase
	 * are protected exactly like a password is.
	 *
	 * @return array{password: string, key: string, passphrase: string}
	 */
	public function credentials(EndpointEntity $endpoint): array {
		$empty = ['password' => '', 'key' => '', 'passphrase' => ''];
		$stored = $endpoint->getSecret();
		if ($stored === null || $stored === '') {
			return $empty;
		}
		try {
			$plain = $this->crypto->decrypt($stored);
		} catch (\Throwable $e) {
			// A changed instance secret makes old ciphertext unreadable. Say so
			// plainly rather than failing with a puzzling authentication error.
			$this->logger->warning('NetBase: stored credential could not be decrypted', ['exception' => $e]);
			throw new \RuntimeException('The stored password could not be decrypted. Please enter it again.');
		}
		$decoded = json_decode($plain, true);
		return is_array($decoded) ? array_merge($empty, array_intersect_key($decoded, $empty)) : $empty;
	}

	/** The stored password on its own, which is all the mail protocols need. */
	public function secret(EndpointEntity $endpoint): string {
		return $this->credentials($endpoint)['password'];
	}

	/** @param array<string, mixed> $data */
	public function save(string $userId, array $data, ?int $id = null): array {
		$kind = (string)($data['kind'] ?? '');
		if (!isset(self::KINDS[$kind])) {
			throw new \InvalidArgumentException('Unknown connection type');
		}
		$host = $this->tools->validateHost((string)($data['host'] ?? ''));
		$port = (int)($data['port'] ?? 0);
		if ($port < 1 || $port > 65535) {
			$port = self::KINDS[$kind]['port'];
		}
		$mode = (string)($data['mode'] ?? self::KINDS[$kind]['modes'][0]);
		if (!in_array($mode, self::KINDS[$kind]['modes'], true)) {
			$mode = self::KINDS[$kind]['modes'][0];
		}

		$options = [
			'mode' => $mode,
			'passive' => (bool)($data['passive'] ?? true),
			'ignoreCert' => (bool)($data['ignoreCert'] ?? false),
			'path' => mb_substr(trim((string)($data['path'] ?? '')), 0, 512),
			'from' => mb_substr(trim((string)($data['from'] ?? '')), 0, 320),
			'authType' => ($data['authType'] ?? 'password') === 'key' ? 'key' : 'password',
		];

		$now = time();
		$entity = $id !== null ? $this->get($id, $userId) : new EndpointEntity();
		if ($id === null) {
			$entity->setUserId($userId);
			$entity->setCreated($now);
		}
		$entity->setName(mb_substr(trim((string)($data['name'] ?? '')) ?: $host, 0, 128));
		$entity->setKind($kind);
		$entity->setHost($host);
		$entity->setPort($port);
		$entity->setUsername(mb_substr(trim((string)($data['username'] ?? '')), 0, 255));
		$entity->setOptions(json_encode($options, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
		$entity->setNotes(mb_substr((string)($data['notes'] ?? ''), 0, 2000));
		$entity->setUpdated($now);

		// An absent field leaves the stored credential alone; an empty string
		// clears it. That way the form can be re-saved without retyping the
		// password or pasting the key again.
		$touched = false;
		$credentials = $id !== null ? $this->credentials($entity) : ['password' => '', 'key' => '', 'passphrase' => ''];
		foreach (['secret' => 'password', 'privateKey' => 'key', 'passphrase' => 'passphrase'] as $field => $slot) {
			if (array_key_exists($field, $data)) {
				$credentials[$slot] = (string)$data[$field];
				$touched = true;
			}
		}
		if ($touched) {
			$hasAny = implode('', $credentials) !== '';
			$entity->setSecret($hasAny ? $this->crypto->encrypt(json_encode($credentials, JSON_UNESCAPED_SLASHES)) : null);
		}

		$saved = $id !== null ? $this->mapper->update($entity) : $this->mapper->insert($entity);
		return $saved->jsonSerialize();
	}

	public function delete(int $id, string $userId): void {
		$this->mapper->delete($this->get($id, $userId));
	}

	/** Records the outcome of the last connection, for the list view. */
	public function touch(EndpointEntity $endpoint, string $result): void {
		$endpoint->setLastUsed(time());
		$endpoint->setLastResult(mb_substr($result, 0, 255));
		try {
			$this->mapper->update($endpoint);
		} catch (\Throwable $e) {
			$this->logger->debug('NetBase: could not record connection result', ['exception' => $e]);
		}
	}

	/** @return array<string, mixed> */
	public function option(EndpointEntity $endpoint, string $key, mixed $fallback = null): mixed {
		$options = $endpoint->getOptions() ? (json_decode($endpoint->getOptions(), true) ?: []) : [];
		return $options[$key] ?? $fallback;
	}
}
