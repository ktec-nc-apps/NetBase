<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\App\IAppManager;
use OCP\IConfig;
use OCP\ISession;
use OCP\Server;
use Psr\Log\LoggerInterface;

/**
 * Connections kept in RegiBase, read from here.
 *
 * RegiBase stores a record's secret fields encrypted in the browser, with a key
 * derived from a master password that is never saved anywhere. So the values
 * arrive here as ciphertext and are of no use until that password is given:
 * the password is asked for once, the derived key is held in the browser's own
 * session, and it is gone the moment that session ends.
 *
 * A field that is not marked secret arrives as plain text and is passed through
 * unchanged — the same thing RegiBase itself does — so a collection part-way
 * through being locked down still reads correctly.
 *
 * RegiBase exposes no public API, so its service is resolved from the server
 * container the way the Tables bridge in RegiBase itself does, and the app is
 * treated as optional throughout.
 */
class RegiBaseBridge {
	private const APP = 'regibase';

	/** The marker RegiBase puts in front of an encrypted value. */
	private const ENC_PREFIX = 'rbenc1:';

	/** Where the derived key lives: the session, and nowhere else. */
	private const SESSION_KEY = 'netbase_regibase_key';

	/** RegiBase's own check value, encrypted with the right key. */
	private const VERIFIER_PLAINTEXT = 'regibase-ok';

	public function __construct(
		private IConfig $config,
		private ISession $session,
		// A collection NetBase offers to build is labelled in NetBase's own
		// language, which an account may set differently from Nextcloud's.
		private L10nService $l,
		private LoggerInterface $logger,
	) {
	}

	/** Whether RegiBase is installed at all. */
	public function available(): bool {
		try {
			return Server::get(IAppManager::class)->isInstalled(self::APP);
		} catch (\Throwable $e) {
			return false;
		}
	}

	/** Whether this account has set up encryption in RegiBase. */
	public function encrypted(string $userId): bool {
		return $this->config->getUserValue($userId, self::APP, 'enc_enabled', '0') === '1'
			&& $this->config->getUserValue($userId, self::APP, 'enc_salt', '') !== ''
			&& $this->config->getUserValue($userId, self::APP, 'enc_verifier', '') !== '';
	}

	/** Whether the master password has been given in this browser session. */
	public function unlocked(): bool {
		return is_string($this->session->get(self::SESSION_KEY))
			&& $this->session->get(self::SESSION_KEY) !== '';
	}

	/**
	 * Take the master password, check it, and keep the derived key for this
	 * session only. The password itself is never stored, here or anywhere.
	 */
	public function unlock(string $userId, string $password): bool {
		$salt = $this->config->getUserValue($userId, self::APP, 'enc_salt', '');
		$verifier = $this->config->getUserValue($userId, self::APP, 'enc_verifier', '');
		if ($salt === '' || $verifier === '' || $password === '') {
			return false;
		}
		$key = $this->derive($password, $salt);
		if ($this->decryptWith($key, $verifier) !== self::VERIFIER_PLAINTEXT) {
			return false;
		}
		$this->session->set(self::SESSION_KEY, base64_encode($key));
		return true;
	}

	/** Forget the key now, without waiting for the session to end. */
	public function lock(): void {
		$this->session->remove(self::SESSION_KEY);
	}

	/**
	 * A stored value, made readable.
	 *
	 * Plain text passes straight through, so a collection only partly locked
	 * down still works. Ciphertext needs the key: without it, null is returned
	 * rather than something that looks like a value.
	 */
	public function reveal(string $value): ?string {
		if (strncmp($value, self::ENC_PREFIX, strlen(self::ENC_PREFIX)) !== 0) {
			return $value;
		}
		$key = $this->key();
		if ($key === null) {
			return null;
		}
		return $this->decryptWith($key, $value);
	}

	/** Whether a value would need the master password to be read. */
	public function isSecret(string $value): bool {
		return strncmp($value, self::ENC_PREFIX, strlen(self::ENC_PREFIX)) === 0;
	}

	/**
	 * The collections this account keeps, as somewhere to read connections
	 * from. Only the name and the field list: no values are touched.
	 *
	 * @return list<array{id: int, name: string, records: int, fields: list<array{key: string, label: string, secret: bool}>}>
	 */
	public function collections(string $userId): array {
		if (!$this->available()) {
			return [];
		}
		try {
			$service = Server::get(\OCA\RegiBase\Service\RegiBaseService::class);
			$out = [];
			foreach ($service->listCollections($userId) as $c) {
				$id = (int)($c['id'] ?? 0);
				if ($id <= 0) {
					continue;
				}
				$full = $service->getCollection($userId, $id);
				$fields = [];
				foreach (($full['fields'] ?? []) as $f) {
					$fields[] = [
						'key' => (string)($f['key'] ?? ''),
						'label' => (string)($f['label'] ?? ''),
						'secret' => !empty($f['secret']),
					];
				}
				$out[] = [
					'id' => $id,
					'name' => (string)($c['name'] ?? ''),
					'records' => (int)($c['record_count'] ?? 0),
					'fields' => $fields,
				];
			}
			return $out;
		} catch (\Throwable $e) {
			$this->logger->warning('NetBase: could not read RegiBase collections', ['exception' => $e, 'app' => 'netbase']);
			return [];
		}
	}

	/**
	 * The records of one collection, with every value made readable where the
	 * key allows it.
	 *
	 * The title is not a column: RegiBase builds it from whichever fields a
	 * collection was told name a row, and hands it over ready-made. It is taken
	 * as given rather than guessed at here, so a row reads in NetBase under the
	 * same name it has in RegiBase.
	 *
	 * @return list<array{id: int, title: string, reading: string, values: array<string, ?string>, locked: list<string>}>
	 */
	public function records(string $userId, int $collectionId): array {
		if (!$this->available()) {
			return [];
		}
		try {
			$service = Server::get(\OCA\RegiBase\Service\RegiBaseService::class);
			$rows = $service->listRecords($userId, $collectionId, null, null, false);
			$out = [];
			foreach ($rows as $r) {
				$values = [];
				$locked = [];
				foreach ((array)($r['data'] ?? []) as $key => $raw) {
					if (!is_string($raw)) {
						$values[(string)$key] = is_scalar($raw) ? (string)$raw : null;
						continue;
					}
					$plain = $this->reveal($raw);
					$values[(string)$key] = $plain;
					// A value that is encrypted and could not be read: say which,
					// so the interface can ask for the master password instead of
					// quietly showing a connection with no password in it.
					if ($plain === null) {
						$locked[] = (string)$key;
					}
				}
				$out[] = [
					'id' => (int)($r['id'] ?? 0),
					'title' => (string)($r['title'] ?? ''),
					'reading' => (string)($r['reading'] ?? ''),
					'values' => $values,
					'locked' => $locked,
				];
			}
			return $out;
		} catch (\Throwable $e) {
			$this->logger->warning('NetBase: could not read RegiBase records', ['exception' => $e, 'app' => 'netbase']);
			return [];
		}
	}

	/**
	 * A value, made ready to store.
	 *
	 * The mirror of reveal(): RegiBase's own format, its own cipher, its own
	 * key — so a connection saved from NetBase opens in RegiBase and a record
	 * edited in RegiBase opens here. Without the master password nothing can
	 * be sealed, and null says so rather than storing something readable.
	 */
	public function seal(string $plain): ?string {
		$key = $this->key();
		if ($key === null) {
			return null;
		}
		$iv = random_bytes(12);
		$tag = '';
		$cipher = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
		if ($cipher === false) {
			return null;
		}
		return self::ENC_PREFIX . base64_encode($iv) . ':' . base64_encode($cipher . $tag);
	}

	/**
	 * Write one record, sealing whatever the collection says is secret.
	 *
	 * $values are in plain text, keyed by RegiBase field key. A value that is
	 * already sealed is left as it is, so re-saving a form that never showed
	 * the password cannot turn the ciphertext into a second layer of itself.
	 *
	 * @param array<string, string> $values
	 * @return array<string, mixed> the stored record
	 */
	public function saveRecord(string $userId, int $collectionId, array $values, ?int $recordId = null): array {
		$secretKeys = [];
		foreach ($this->fieldsOf($userId, $collectionId) as $field) {
			if ($field['secret']) {
				$secretKeys[$field['key']] = true;
			}
		}
		$data = [];
		foreach ($values as $key => $value) {
			$value = (string)$value;
			if (!isset($secretKeys[$key]) || $value === '' || $this->isSecret($value)) {
				$data[$key] = $value;
				continue;
			}
			$sealed = $this->seal($value);
			if ($sealed === null) {
				throw new \RuntimeException('The master password is needed before a password can be saved.');
			}
			$data[$key] = $sealed;
		}
		$service = Server::get(\OCA\RegiBase\Service\RegiBaseService::class);
		return $recordId === null
			? $service->createRecord($userId, $collectionId, $data)
			: $service->updateRecord($userId, $recordId, $data);
	}

	/** Throw one record away. */
	public function deleteRecord(string $userId, int $recordId): void {
		Server::get(\OCA\RegiBase\Service\RegiBaseService::class)->deleteRecord($userId, $recordId);
	}

	/**
	 * One record as it is stored, without decrypting anything.
	 *
	 * Used when a form is saved: the fields it did not show have to be carried
	 * over untouched, and untouched means the ciphertext exactly as it stands.
	 *
	 * @return array<string, string>
	 */
	public function rawValues(string $userId, int $recordId): array {
		try {
			$record = Server::get(\OCA\RegiBase\Service\RegiBaseService::class)->getRecord($userId, $recordId);
			$out = [];
			foreach ((array)($record['data'] ?? []) as $key => $value) {
				$out[(string)$key] = is_scalar($value) ? (string)$value : '';
			}
			return $out;
		} catch (\Throwable $e) {
			return [];
		}
	}

	/**
	 * The fields of one collection.
	 *
	 * @return list<array{key: string, label: string, secret: bool}>
	 */
	public function fieldsOf(string $userId, int $collectionId): array {
		try {
			$full = Server::get(\OCA\RegiBase\Service\RegiBaseService::class)->getCollection($userId, $collectionId);
			$out = [];
			foreach (($full['fields'] ?? []) as $f) {
				$out[] = [
					'key' => (string)($f['key'] ?? ''),
					'label' => (string)($f['label'] ?? ''),
					'secret' => !empty($f['secret']),
				];
			}
			return $out;
		} catch (\Throwable $e) {
			return [];
		}
	}

	/**
	 * Make a collection shaped for one kind of connection.
	 *
	 * The shape comes from NetBase, not from RegiBase's own template list: the
	 * fields are handed over outright and RegiBase stores what it is given. So
	 * an SSH list, an FTP list and a mail list can each be offered here without
	 * anything being added to RegiBase to make it possible.
	 *
	 * Nothing here is required: a collection built by hand works just as well,
	 * because which field means what is decided by the assignment, not by these
	 * names. This is the shortcut, not the rule.
	 *
	 * @param string $group one of EndpointService::GROUPS; an unknown one is
	 *                      treated as SSH rather than refused, so a newer
	 *                      browser cannot leave somebody with no collection.
	 * @return array<string, mixed> the created collection
	 */
	public function createConnectionCollection(string $userId, string $group, string $name): array {
		$service = Server::get(\OCA\RegiBase\Service\RegiBaseService::class);
		$shape = self::TEMPLATES[$group] ?? self::TEMPLATES['ssh'];
		return $service->createCollection($userId, [
			'name' => $name,
			'icon' => $shape['icon'],
			'color' => $shape['color'],
			'view' => 'table',
			'fields' => $this->fieldsFor($shape),
		]);
	}

	/**
	 * The shape of a ready-made collection, one per kind of connection.
	 *
	 * These live here rather than in RegiBase's own template list, because they
	 * are NetBase's idea of what a connection is: RegiBase is handed the fields
	 * outright and stores what it is given. A collection built by hand works
	 * just as well — which field means what is decided by the assignment, not by
	 * these names — so this is the shortcut, not the rule.
	 *
	 * Each carries only the fields its kind can use. An SSH list has no reason
	 * to hold a sender address, and a mailbox has none to hold a private key;
	 * offering them anyway is how a form ends up asking for things nobody fills
	 * in. 'slots' are NetBase's own names, so a collection built from one of
	 * these needs no assignment done by hand.
	 *
	 * @var array<string, array{icon: string, color: string, kinds: list<string>, slots: list<string>}>
	 */
	private const TEMPLATES = [
		'ssh' => [
			'icon' => '🔐', 'color' => '#0891b2',
			'kinds' => ['ssh'],
			'slots' => ['name', 'kind', 'host', 'port', 'username', 'password',
				'privatekey', 'passphrase', 'publickey', 'options', 'notes'],
		],
		'scp' => [
			'icon' => '📦', 'color' => '#0d9488',
			'kinds' => ['scp'],
			'slots' => ['name', 'kind', 'host', 'port', 'username', 'password',
				'privatekey', 'passphrase', 'publickey', 'options', 'notes'],
		],
		'ftp' => [
			'icon' => '📁', 'color' => '#2563eb',
			'kinds' => ['ftp', 'sftp'],
			'slots' => ['name', 'kind', 'host', 'port', 'username', 'password',
				'privatekey', 'passphrase', 'options', 'notes'],
		],
		// One row is one mail address. It is read before it is written to, and
		// that is the order the columns follow: how it is received, then where
		// it is sent from. The user name and password serve both halves.
		'mail' => [
			'icon' => '📧', 'color' => '#7c3aed',
			'kinds' => ['imap', 'pop3', 'smtp'],
			'slots' => ['name', 'kind', 'host', 'port', 'username', 'password', 'sendhost', 'sendport', 'options', 'notes'],
			'labels' => [
				'kind' => 'How it is received',
				'host' => 'Incoming server',
				'port' => 'Incoming port',
			],
		],
	];

	/**
	 * One template turned into the fields RegiBase is asked to create.
	 *
	 * The labels are NetBase's own slot labels, translated, so the collection
	 * reads in the language of whoever asked for it. The password, the private
	 * key and its passphrase are marked secret; the public key deliberately is
	 * not — it is public, and sealing it would only make it harder to paste
	 * where it has to go.
	 *
	 * @param array{icon: string, color: string, kinds: list<string>, slots: list<string>} $shape
	 * @return list<array<string, mixed>>
	 */
	private function fieldsFor(array $shape): array {
		$type = [
			'password' => 'password', 'passphrase' => 'password',
			'privatekey' => 'textarea', 'publickey' => 'textarea', 'notes' => 'textarea',
		];
		$secret = ['password' => true, 'privatekey' => true, 'passphrase' => true];
		$slots = \OCA\NetBase\Service\EndpointService::SLOTS;
		$out = [];
		foreach ($shape['slots'] as $slot) {
			$field = [
				'key' => $slot,
				// A template may rename a slot for its own collection: "Host" is
				// the honest name in general, but in a list of mail accounts the
				// column people are looking for is the incoming server.
				'label' => $this->l->t($shape['labels'][$slot] ?? $slots[$slot]['label'] ?? $slot),
				'type' => $type[$slot] ?? 'text',
			];
			if (isset($secret[$slot])) {
				$field['secret'] = true;
			}
			if ($slot === 'name') {
				$field['is_title'] = true;
				$field['required'] = true;
			}
			if ($slot === 'host') {
				$field['required'] = true;
			}
			if ($slot === 'kind') {
				// Only the kinds this collection is for. A mailbox list offering
				// "ssh" invites a record nothing will ever read.
				$field['type'] = 'select';
				$field['options'] = $shape['kinds'];
			}
			$out[] = $field;
		}
		return $out;
	}

	/** RegiBase's key derivation, matched exactly. */
	private function derive(string $password, string $saltB64): string {
		return hash_pbkdf2('sha256', $password, (string)base64_decode($saltB64, true), 250000, 32, true);
	}

	/** The key held for this session, or null when none has been given. */
	private function key(): ?string {
		$held = $this->session->get(self::SESSION_KEY);
		if (!is_string($held) || $held === '') {
			return null;
		}
		$raw = base64_decode($held, true);
		return ($raw === false || $raw === '') ? null : $raw;
	}

	/** RegiBase's own format: rbenc1:<base64 iv>:<base64 ciphertext+tag>. */
	private function decryptWith(string $key, string $value): ?string {
		if (strncmp($value, self::ENC_PREFIX, strlen(self::ENC_PREFIX)) !== 0) {
			return $value;
		}
		$parts = explode(':', substr($value, strlen(self::ENC_PREFIX)));
		if (count($parts) < 2) {
			return null;
		}
		$iv = base64_decode($parts[0], true);
		$blob = base64_decode($parts[1], true);
		if ($iv === false || $blob === false || strlen($blob) < 16) {
			return null;
		}
		$tag = substr($blob, -16);
		$cipher = substr($blob, 0, -16);
		$plain = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
		return $plain === false ? null : $plain;
	}
}
