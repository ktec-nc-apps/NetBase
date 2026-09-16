<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\EndpointEntity;
use OCP\Files\IRootFolder;
use OCP\Files\File;
use OCP\Files\NotFoundException;
use OCP\IConfig;
use OCP\Security\ICrypto;
use Psr\Log\LoggerInterface;

/**
 * Saved connections — the SSH / SFTP / FTP / mail servers a user works with.
 *
 * These used to live in a table of NetBase's own. They live in RegiBase now,
 * as ordinary records in a collection the user owns, for one reason: RegiBase
 * already solves the hard half of this properly. A password there is sealed in
 * the browser with a key derived from a master password that is stored nowhere
 * — not in the database, not in the config, not on disk — so a stolen database
 * is a database of ciphertext. NetBase could not offer that on its own: its own
 * store was encrypted with the instance secret, which sits on the same server
 * as the data it protects.
 *
 * What that costs, and why it is worth it:
 *
 *  - RegiBase has to be installed. Without it there is nowhere to keep a
 *    connection, and NetBase says so rather than inventing a weaker store.
 *  - The master password has to be given once per browser session before a
 *    stored password can be read or written. It is never saved: the key derived
 *    from it lives in that session and dies with it.
 *  - Which field means what is not fixed. A RegiBase collection is built by
 *    whoever owns it, so NetBase is told the mapping — this field is the host,
 *    that one is the password — and adapts to the collection rather than
 *    demanding a collection shaped for NetBase. A ready-made one can be created
 *    for anybody who would rather not build it by hand.
 *
 * Everything downstream — SSH, SFTP, FTP, the terminals, the mail tools — is
 * unchanged: it still receives an EndpointEntity and still asks this service
 * for the credentials. Only where they are kept has moved.
 */
class EndpointService {
	/** kind => [default port, encryption modes, label] */
	public const KINDS = [
		'ftp' => ['port' => 21, 'modes' => ['none', 'starttls', 'tls'], 'label' => 'FTP'],
		'sftp' => ['port' => 22, 'modes' => ['ssh'], 'label' => 'SFTP (over SSH)'],
		// One address, one record. A mail account is read with IMAP or POP3 and
		// sent through SMTP, but it is still one account with one user name and
		// one password — so the kind names how it is *read*, and the outgoing
		// server rides along in fields of its own. SMTP stays as a kind for a
		// send-only relay, which is a real thing and has no mailbox behind it.
		'imap' => ['port' => 993, 'modes' => ['tls', 'starttls', 'none'], 'label' => 'IMAP'],
		'pop3' => ['port' => 995, 'modes' => ['tls', 'starttls', 'none'], 'label' => 'POP3'],
		'smtp' => ['port' => 587, 'modes' => ['starttls', 'tls', 'none'], 'label' => 'SMTP only (no mailbox)'],
		'scp' => ['port' => 22, 'modes' => ['ssh'], 'label' => 'SCP (over SSH)'],
		'ssh' => ['port' => 22, 'modes' => ['ssh'], 'label' => 'SSH'],
	];

	/**
	 * What NetBase needs a connection to have, and whether it has to be secret.
	 *
	 * The left-hand names are NetBase's own; the right-hand side of the mapping
	 * is whatever the collection happens to call them. Only 'host' is required:
	 * a connection with no address is not a connection. Anything unmapped is
	 * simply not stored, which is the honest behaviour for a collection that
	 * has no field for it.
	 *
	 * @var array<string, array{label: string, secret: bool}>
	 */
	public const SLOTS = [
		'name' => ['label' => 'Name', 'secret' => false],
		'kind' => ['label' => 'Type', 'secret' => false],
		'host' => ['label' => 'Host', 'secret' => false],
		'port' => ['label' => 'Port', 'secret' => false],
		'username' => ['label' => 'User name', 'secret' => false],
		'password' => ['label' => 'Password', 'secret' => true],
		'privatekey' => ['label' => 'Private key', 'secret' => true],
		'passphrase' => ['label' => 'Key passphrase', 'secret' => true],
		'publickey' => ['label' => 'Public key', 'secret' => false],
		// The sending half of a mail account. One address is one record, and the
		// receiving side is the record's own host and port — that is the account
		// as its owner thinks of it — so the outgoing server follows after,
		// sharing the same user name and password.
		'sendhost' => ['label' => 'Outgoing server', 'secret' => false],
		'sendport' => ['label' => 'Outgoing port', 'secret' => false],
		'options' => ['label' => 'Settings', 'secret' => false],
		'notes' => ['label' => 'Notes', 'secret' => false],
	];

	/**
	 * How saved connections are divided up.
	 *
	 * One collection for everything was wrong in practice: SCP reuses the SSH
	 * credentials, but FTP is a different account on a different machine, and
	 * they were being read out of the same place. Each group now names its own
	 * collection and its own field assignment.
	 *
	 * The same collection may be named by as many groups as the owner likes —
	 * SSH and SCP usually are the same list — so separating them costs nothing
	 * to anyone who does not need it. Mail is one group because SMTP, IMAP and
	 * POP3 are three ways into the same mailbox.
	 *
	 * @var array<string, array{label: string, kinds: list<string>}>
	 */
	public const GROUPS = [
		'ssh' => ['label' => 'SSH / Telnet', 'kinds' => ['ssh']],
		'scp' => ['label' => 'SCP', 'kinds' => ['scp']],
		'ftp' => ['label' => 'FTP / SFTP', 'kinds' => ['ftp', 'sftp']],
		// Receiving comes first, here as everywhere else: a record with no type
		// of its own falls back to the first kind of its group, and a mail
		// account is read before it is sent from.
		'mail' => ['label' => 'Mail accounts', 'kinds' => ['imap', 'pop3', 'smtp']],
	];

	/** The collections this account can see, worked out once per request. */
	private ?array $present = null;

	private const C_COLLECTION = 'conn_collection';
	private const C_MAP = 'conn_map';
	private const C_META = 'conn_meta';

	public function __construct(
		private RegiBaseBridge $regibase,
		private ICrypto $crypto,
		private ToolService $tools,
		private IRootFolder $rootFolder,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	// ---------------------------------------------------------------- where they live

	/** Whether there is anywhere at all to keep a connection. */
	public function available(): bool {
		return $this->regibase->available();
	}

	/** Which group a connection of this type belongs to. */
	public static function groupOf(string $kind): string {
		foreach (self::GROUPS as $group => $meta) {
			if (in_array($kind, $meta['kinds'], true)) {
				return $group;
			}
		}
		return 'ssh';
	}

	/**
	 * The collection one group is kept in, or 0 when none has been chosen.
	 *
	 * Where a group has not been given a collection of its own, the single
	 * setting from 0.6.0 still answers. Nothing is moved and nothing is lost on
	 * upgrade: the list reads exactly as it did until a group is pointed
	 * somewhere else deliberately.
	 */
	public function collectionId(string $userId, string $group): int {
		if (!isset(self::GROUPS[$group])) {
			return 0;
		}
		$own = $this->config->getUserValue($userId, 'netbase', self::C_COLLECTION . '_' . $group, '');
		if ($own !== '') {
			return (int)$own;
		}
		return (int)$this->config->getUserValue($userId, 'netbase', self::C_COLLECTION, '0');
	}

	/**
	 * Which field of that collection holds which part of a connection.
	 *
	 * @return array<string, string> NetBase slot => RegiBase field key
	 */
	public function mapping(string $userId, string $group): array {
		if (!isset(self::GROUPS[$group])) {
			return [];
		}
		$raw = $this->config->getUserValue($userId, 'netbase', self::C_MAP . '_' . $group, '');
		if ($raw === '') {
			$raw = $this->config->getUserValue($userId, 'netbase', self::C_MAP, '[]');
		}
		$stored = json_decode($raw, true);
		$map = [];
		foreach (array_keys(self::SLOTS) as $slot) {
			$value = is_array($stored) ? (string)($stored[$slot] ?? '') : '';
			if ($value !== '') {
				$map[$slot] = $value;
			}
		}
		return $map;
	}

	/**
	 * Whether connections can be stored: a collection that is still there, and
	 * at least a host.
	 *
	 * The collection is checked for existence, not merely for a number. One
	 * deleted in RegiBase left the number behind, and everything went on
	 * reporting itself as set up: the list came back empty with no reason
	 * given, and saving failed with RegiBase's own words for it.
	 *
	 * With no group named, the question is whether any group at all is usable,
	 * which is what the screens ask before offering to save anything.
	 */
	public function ready(string $userId, ?string $group = null): bool {
		if (!$this->available()) {
			return false;
		}
		if ($group !== null) {
			return $this->collectionExists($userId, $this->collectionId($userId, $group))
				&& ($this->mapping($userId, $group)['host'] ?? '') !== '';
		}
		foreach (array_keys(self::GROUPS) as $each) {
			if ($this->ready($userId, $each)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Whether a collection with this number is still there.
	 *
	 * Asked of the list the account can actually see, which is the same list
	 * the settings screen offers — so "chosen" and "offered" can never drift
	 * apart. The answer is worked out once per request.
	 */
	private function collectionExists(string $userId, int $id): bool {
		if ($id <= 0) {
			return false;
		}
		if ($this->present === null) {
			$this->present = [];
			foreach ($this->regibase->collections($userId) as $c) {
				$this->present[(int)$c['id']] = true;
			}
		}
		return isset($this->present[$id]);
	}

	/**
	 * Whether a group points at a collection that is no longer there.
	 *
	 * Different from "not set up": something was chosen, and it has since gone.
	 * The two need saying differently, or the reader is told to choose a
	 * collection they believe they already chose.
	 */
	public function collectionGone(string $userId, string $group): bool {
		$id = $this->collectionId($userId, $group);
		return $id > 0 && !$this->collectionExists($userId, $id);
	}

	/** Whether the master password has been given in this browser session. */
	public function unlocked(): bool {
		return $this->regibase->unlocked();
	}

	/** Take the master password for this session only. */
	public function unlock(string $userId, string $password): bool {
		return $this->regibase->unlock($userId, $password);
	}

	/** Give the key up now, without waiting for the session to end. */
	public function lock(): void {
		$this->regibase->lock();
	}

	/**
	 * Everything the settings screen needs to show where connections are kept:
	 * the collections to choose from, the fields of the chosen one, the mapping
	 * as it stands, and whether anything is missing.
	 *
	 * @return array<string, mixed>
	 */
	public function setup(string $userId): array {
		$groups = [];
		foreach (self::GROUPS as $group => $meta) {
			$collectionId = $this->collectionId($userId, $group);
			$groups[$group] = [
				'label' => $meta['label'],
				'kinds' => $meta['kinds'],
				'collection' => $collectionId,
				'mapping' => $this->mapping($userId, $group),
				'ready' => $this->ready($userId, $group),
				'gone' => $this->collectionGone($userId, $group),
			];
		}
		return [
			'available' => $this->available(),
			'encrypted' => $this->regibase->encrypted($userId),
			'unlocked' => $this->unlocked(),
			'ready' => $this->ready($userId),
			'collections' => $this->regibase->collections($userId),
			'groups' => $groups,
			'slots' => self::SLOTS,
		];
	}

	/**
	 * Point NetBase at a collection and say which field is which.
	 *
	 * A slot named after a field the collection does not have is dropped rather
	 * than stored, so a mapping can never point at nothing.
	 *
	 * @param array<string, string> $map
	 * @return array<string, mixed>
	 */
	public function mapTo(string $userId, string $group, int $collectionId, array $map): array {
		if (!$this->available()) {
			throw new \RuntimeException('RegiBase is needed to keep connections and is not installed.');
		}
		if (!isset(self::GROUPS[$group])) {
			throw new \InvalidArgumentException('Unknown connection group');
		}
		if (!$this->unlocked()) {
			// Changing where connections live decides what the stored passwords
			// are read with. Somebody holding a signed-in browser but not the
			// master key must not be able to point NetBase somewhere else.
			throw new \RuntimeException('The RegiBase master password is needed to change where connections are kept.');
		}
		$fields = [];
		foreach ($this->regibase->fieldsOf($userId, $collectionId) as $field) {
			$fields[$field['key']] = $field;
		}
		if ($fields === []) {
			throw new \InvalidArgumentException('That collection could not be read.');
		}
		$clean = [];
		foreach (array_keys(self::SLOTS) as $slot) {
			$key = trim((string)($map[$slot] ?? ''));
			if ($key !== '' && isset($fields[$key])) {
				$clean[$slot] = $key;
			}
		}
		if (($clean['host'] ?? '') === '') {
			throw new \InvalidArgumentException('At least the host has to be matched to a field.');
		}
		// A password kept in a field that is not marked secret would be stored
		// in plain text. Say so plainly instead of quietly doing it.
		foreach (self::SLOTS as $slot => $meta) {
			if ($meta['secret'] && isset($clean[$slot]) && !$fields[$clean[$slot]]['secret']) {
				throw new \InvalidArgumentException(
					'The field chosen for "' . $meta['label'] . '" is not a secret field in RegiBase. '
					. 'Mark it secret there first, or choose another field.'
				);
			}
		}
		$this->config->setUserValue($userId, 'netbase', self::C_COLLECTION . '_' . $group, (string)$collectionId);
		$this->config->setUserValue($userId, 'netbase', self::C_MAP . '_' . $group, (string)json_encode($clean));
		return $this->setup($userId);
	}

	/**
	 * Build a collection shaped for connections, and point NetBase at it.
	 *
	 * @return array<string, mixed>
	 */
	public function createCollection(string $userId, string $group, string $name): array {
		if (!$this->available()) {
			throw new \RuntimeException('RegiBase is needed to keep connections and is not installed.');
		}
		if (!$this->unlocked()) {
			// Changing where connections live decides what the stored passwords
			// are read with. Somebody holding a signed-in browser but not the
			// master key must not be able to point NetBase somewhere else.
			throw new \RuntimeException('The RegiBase master password is needed to change where connections are kept.');
		}
		if (!isset(self::GROUPS[$group])) {
			throw new \InvalidArgumentException('Unknown connection group');
		}
		// A list named after nothing in particular is hard to find again later,
		// so an unnamed one is named after what it holds.
		$name = trim($name) !== ''
			? mb_substr(trim($name), 0, 64)
			: 'NetBase — ' . self::GROUPS[$group]['label'];
		$collection = $this->regibase->createConnectionCollection($userId, $group, $name);
		$id = (int)($collection['id'] ?? 0);
		if ($id <= 0) {
			throw new \RuntimeException('The collection could not be created.');
		}
		// It was built to this shape, so the assignment is one to one. A slot the
		// template left out is simply not there, and mapTo() drops it rather than
		// storing an assignment that points at nothing.
		$map = [];
		foreach (array_keys(self::SLOTS) as $slot) {
			$map[$slot] = $slot;
		}
		return $this->mapTo($userId, $group, $id, $map);
	}

	// ---------------------------------------------------------------- the connections

	/** @return array<int, array<string, mixed>> */
	public function list(string $userId): array {
		if (!$this->ready($userId)) {
			return [];
		}
		$meta = $this->meta($userId);
		$out = [];
		$seen = [];
		foreach (array_keys(self::GROUPS) as $group) {
			$collectionId = $this->collectionId($userId, $group);
			$map = $this->mapping($userId, $group);
			// A collection two groups share is read once, never twice: the same
			// saved connection must not appear in the list as two of them.
			if ($collectionId <= 0 || ($map['host'] ?? '') === '' || isset($seen[$collectionId])) {
				continue;
			}
			$seen[$collectionId] = true;
			foreach ($this->regibase->records($userId, $collectionId) as $record) {
				$out[] = $this->present($record, $map, $meta, $group);
			}
		}
		usort($out, static fn (array $a, array $b): int => strcasecmp((string)$a['name'], (string)$b['name']));
		return $out;
	}

	public function get(int $id, string $userId): EndpointEntity {
		if (!$this->ready($userId)) {
			throw new \RuntimeException('No collection has been chosen to keep connections in.');
		}
		$found = $this->locate($userId, $id);
		if ($found === null) {
			throw new \RuntimeException('No such saved connection');
		}
		return $this->toEntity($userId, $found['record'], $found['map'], $found['group']);
	}

	/**
	 * Which group a saved connection lives in, and the record itself.
	 *
	 * Every group is searched, because a connection has to stay reachable by
	 * its id whichever collection now holds it.
	 *
	 * @return array{group: string, map: array<string, string>, record: array<string, mixed>}|null
	 */
	private function locate(string $userId, int $id): ?array {
		$seen = [];
		foreach (array_keys(self::GROUPS) as $group) {
			$collectionId = $this->collectionId($userId, $group);
			$map = $this->mapping($userId, $group);
			if ($collectionId <= 0 || ($map['host'] ?? '') === '' || isset($seen[$collectionId])) {
				continue;
			}
			$seen[$collectionId] = true;
			foreach ($this->regibase->records($userId, $collectionId) as $record) {
				if ((int)($record['id'] ?? 0) === $id) {
					return ['group' => $group, 'map' => $map, 'record' => $record];
				}
			}
		}
		return null;
	}

	/**
	 * The stored credentials, for one connection.
	 *
	 * They reach here already gathered by get(), sealed in memory with the
	 * instance secret so that nothing downstream holds a password in a plain
	 * property. That is a hand-off, not storage: what is on disk is sealed with
	 * the user's own master key and nothing else.
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
			$this->logger->warning('NetBase: a credential could not be unpacked', ['exception' => $e]);
			throw new \RuntimeException('The stored password could not be read. Please enter it again.');
		}
		$decoded = json_decode($plain, true);
		return is_array($decoded) ? array_merge($empty, array_intersect_key($decoded, $empty)) : $empty;
	}

	/** The stored password on its own, which is all the mail protocols need. */
	public function secret(EndpointEntity $endpoint): string {
		return $this->credentials($endpoint)['password'];
	}

	/**
	 * Save a connection, as a record in the chosen collection.
	 *
	 * A credential the form did not show is carried over exactly as it stands —
	 * still sealed — so re-saving a connection without retyping the password
	 * neither loses it nor seals the ciphertext a second time.
	 *
	 * @param array<string, mixed> $data
	 * @return array<string, mixed>
	 */
	public function save(string $userId, array $data, ?int $id = null): array {
		if (!$this->available()) {
			throw new \RuntimeException('RegiBase is needed to keep connections and is not installed.');
		}
		$kind = (string)($data['kind'] ?? '');
		if (!isset(self::KINDS[$kind])) {
			throw new \InvalidArgumentException('Unknown connection type');
		}
		// Each type is kept where that type was told to go, which is the whole
		// point of the separation: SCP follows the SSH list, FTP need not.
		$group = self::groupOf($kind);
		if ($this->collectionGone($userId, $group)) {
			// Not the same as never having chosen one. Saying "choose one" to
			// somebody who did would send them looking for their own mistake.
			throw new \RuntimeException('The RegiBase collection kept for '
				. self::GROUPS[$group]['label']
				. ' connections is gone — it was deleted in RegiBase. Choose another one, or make a new one.');
		}
		if (!$this->ready($userId, $group)) {
			throw new \RuntimeException('Choose a RegiBase collection for ' . self::GROUPS[$group]['label'] . ' connections first.');
		}
		$host = $this->tools->validateHost((string)($data['host'] ?? ''));
		$port = (int)($data['port'] ?? 0);
		if ($port < 1 || $port > 65535) {
			$port = self::KINDS[$kind]['port'];
		}
		$map = $this->mapping($userId, $group);
		$collectionId = $this->collectionId($userId, $group);

		// Whatever is already stored, untouched, as the starting point.
		$values = $id !== null ? $this->regibase->rawValues($userId, $id) : [];

		$put = function (string $slot, string $value) use (&$values, $map): void {
			if (isset($map[$slot])) {
				$values[$map[$slot]] = $value;
			}
		};
		$put('name', mb_substr(trim((string)($data['name'] ?? '')) ?: $host, 0, 128));
		$put('kind', $kind);
		$put('host', $host);
		$put('port', (string)$port);
		$put('username', mb_substr(trim((string)($data['username'] ?? '')), 0, 255));
		// The outgoing half of a mail account, in columns of its own so that the
		// collection reads as one account per row: how it is received first,
		// then where it is sent from.
		$put('sendhost', mb_substr(trim((string)($data['sendHost'] ?? '')), 0, 255));
		$sendPort = (int)($data['sendPort'] ?? 0);
		$put('sendport', $sendPort > 0 && $sendPort < 65536 ? (string)$sendPort : '');
		$put('notes', mb_substr((string)($data['notes'] ?? ''), 0, 2000));
		$put('options', (string)json_encode($this->optionsFrom($kind, $data), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

		// A key can be named by its path in the user's own Nextcloud files,
		// which keeps it out of the browser entirely: the server reads the file,
		// as that user, and stores what it finds.
		$keyPath = trim((string)($data['privateKeyPath'] ?? ''));
		if ($keyPath !== '') {
			$data['privateKey'] = $this->readKeyFile($userId, $keyPath);
		}
		// An absent credential means "keep the stored one"; an empty string
		// clears it. Present ones need the master password, because the field
		// they go into is a secret field.
		foreach (['secret' => 'password', 'privateKey' => 'privatekey', 'passphrase' => 'passphrase'] as $field => $slot) {
			if (!array_key_exists($field, $data)) {
				continue;
			}
			if (!isset($map[$slot])) {
				continue;
			}
			if (!$this->unlocked()) {
				throw new \RuntimeException('The RegiBase master password is needed before a password can be saved.');
			}
			$values[$map[$slot]] = (string)$data[$field];
		}

		$record = $this->regibase->saveRecord($userId, $collectionId, $values, $id);
		$saved = (int)($record['id'] ?? 0);
		if ($id === null && $saved > 0) {
			$this->remember($userId, $saved, ['created' => time()]);
		}
		$this->remember($userId, $saved, ['updated' => time()]);
		return $this->present($this->readOne($userId, $collectionId, $saved), $map, $this->meta($userId), $group);
	}

	/**
	 * The contents of a private key stored in the user's Nextcloud files.
	 *
	 * A folder has a size like a file does, so asking for the size told us
	 * nothing — and a folder has no getContent(), so the next line brought the
	 * whole request down with "Call to undefined method". From the outside that
	 * looked like a connection that simply would not work, with no reason given.
	 * A folder is a plausible thing to choose here: the key folder is a setting
	 * of its own, and the two are easy to confuse. So it is named as the mistake
	 * it is, rather than being allowed to crash.
	 */
	public function readKeyFile(string $userId, string $path): string {
		try {
			$node = $this->rootFolder->getUserFolder($userId)->get(ltrim($path, '/'));
		} catch (NotFoundException) {
			throw new \InvalidArgumentException('No such file in your Nextcloud files: ' . $path);
		}
		if (!$node instanceof File) {
			throw new \InvalidArgumentException('That is a folder, not a key. Open it and choose the key file inside — the one with no .pub at the end.');
		}
		if ($node->getSize() > 262144) {
			throw new \InvalidArgumentException('That file is too large to be a private key');
		}
		$content = (string)$node->getContent();
		if (trim($content) === '') {
			throw new \InvalidArgumentException('That file is empty.');
		}
		if (!str_contains($content, 'PRIVATE KEY')) {
			throw new \InvalidArgumentException('That file does not look like a private key. Use the file that has no .pub at the end.');
		}
		return $content;
	}

	public function delete(int $id, string $userId): void {
		if (!$this->ready($userId)) {
			throw new \RuntimeException('No collection has been chosen to keep connections in.');
		}
		$this->regibase->deleteRecord($userId, $id);
		$meta = $this->meta($userId);
		unset($meta[(string)$id]);
		$this->config->setUserValue($userId, 'netbase', self::C_META, (string)json_encode($meta));
	}

	/**
	 * A connection that is used once and never stored — the details typed into
	 * the form for a server someone just wants to look at.
	 *
	 * Nothing here touches RegiBase: a one-off connection is not saved, so it
	 * needs no collection, no mapping and no master password. It is the way to
	 * reach a server on an instance that has no RegiBase at all.
	 *
	 * @param array<string, mixed> $data
	 */
	public function transient(string $userId, array $data): EndpointEntity {
		$kind = (string)($data['kind'] ?? '');
		if (!isset(self::KINDS[$kind])) {
			throw new \InvalidArgumentException('Unknown connection type');
		}
		$entity = new EndpointEntity();
		$entity->setUserId($userId);
		$entity->setKind($kind);
		$entity->setHost($this->tools->validateHost((string)($data['host'] ?? '')));
		$port = (int)($data['port'] ?? 0);
		$entity->setPort($port > 0 && $port < 65536 ? $port : self::KINDS[$kind]['port']);
		$entity->setUsername(mb_substr(trim((string)($data['username'] ?? '')), 0, 255));
		$entity->setOptions((string)json_encode($this->optionsFrom($kind, $data), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

		$key = (string)($data['privateKey'] ?? '');
		$keyPath = trim((string)($data['privateKeyPath'] ?? ''));
		if ($keyPath !== '') {
			$key = $this->readKeyFile($userId, $keyPath);
		}
		$this->carry($entity, [
			'password' => (string)($data['secret'] ?? ''),
			'key' => $key,
			'passphrase' => (string)($data['passphrase'] ?? ''),
		]);
		return $entity;
	}

	/** Records the outcome of the last connection, for the list view. */
	public function touch(EndpointEntity $endpoint, string $result): void {
		$id = $endpoint->getId();
		$userId = (string)$endpoint->getUserId();
		if ($id === null || $userId === '') {
			// A one-off connection has nothing to record against.
			return;
		}
		$this->remember($userId, (int)$id, ['lastUsed' => time(), 'lastResult' => mb_substr($result, 0, 255)]);
	}

	/** @return array<string, mixed> */
	public function option(EndpointEntity $endpoint, string $key, mixed $fallback = null): mixed {
		$options = $endpoint->getOptions() ? (json_decode($endpoint->getOptions(), true) ?: []) : [];
		return $options[$key] ?? $fallback;
	}

	// ---------------------------------------------------------------- inside

	/**
	 * The settings that are not a field of their own: how to encrypt, where to
	 * start, who a message is from.
	 *
	 * @param array<string, mixed> $data
	 * @return array<string, mixed>
	 */
	private function optionsFrom(string $kind, array $data): array {
		$mode = (string)($data['mode'] ?? self::KINDS[$kind]['modes'][0]);
		return [
			'mode' => in_array($mode, self::KINDS[$kind]['modes'], true) ? $mode : self::KINDS[$kind]['modes'][0],
			'passive' => (bool)($data['passive'] ?? true),
			'ignoreCert' => (bool)($data['ignoreCert'] ?? false),
			'path' => mb_substr(trim((string)($data['path'] ?? '')), 0, 512),
			'from' => mb_substr(trim((string)($data['from'] ?? '')), 0, 320),
			'authType' => ($data['authType'] ?? 'password') === 'key' ? 'key' : 'password',
			// How the outgoing server is reached. Its address and port are fields
			// of their own; only the encryption is kept here, next to the
			// incoming one it sits beside.
			'sendMode' => in_array($data['sendMode'] ?? '', ['starttls', 'tls', 'none'], true) ? (string)$data['sendMode'] : 'starttls',
		];
	}

	/**
	 * One stored record as the browser sees it: never a credential, only
	 * whether one is there.
	 *
	 * @param array<string, mixed> $record
	 * @param array<string, string> $map
	 * @param array<string, array<string, mixed>> $meta
	 * @return array<string, mixed>
	 */
	private function present(array $record, array $map, array $meta, string $group): array {
		$id = (int)($record['id'] ?? 0);
		$values = (array)($record['values'] ?? []);
		$locked = (array)($record['locked'] ?? []);
		$mine = $meta[(string)$id] ?? [];

		$read = static function (string $slot) use ($values, $map): string {
			$key = $map[$slot] ?? '';
			return $key === '' ? '' : (string)($values[$key] ?? '');
		};
		// "Is there a password?" must be answerable while the key is not held,
		// or a locked list would look like a list of connections with no
		// credentials at all.
		$has = static function (string $slot) use ($values, $map, $locked): bool {
			$key = $map[$slot] ?? '';
			if ($key === '') {
				return false;
			}
			return in_array($key, $locked, true) || (string)($values[$key] ?? '') !== '';
		};

		$kind = $read('kind');
		if (!isset(self::KINDS[$kind])) {
			// A record that does not say what it is, is whatever the collection it
			// came from is for. Calling everything SSH, as this once did, put FTP
			// servers in the SSH list.
			$kind = self::GROUPS[$group]['kinds'][0] ?? 'ssh';
		}
		$options = json_decode($read('options'), true);
		$options = is_array($options) ? $options : [];
		$port = (int)$read('port');
		// The outgoing server of a mail account. It is a column of its own in
		// RegiBase — the person reading the collection wants to see it there,
		// after the incoming side — but downstream it travels in the options,
		// where everything else about how a connection is reached already does.
		$sendHost = $read('sendhost');
		$sendPort = (int)$read('sendport');
		if ($sendHost !== '') {
			$options['sendHost'] = $sendHost;
		}
		if ($sendPort > 0) {
			$options['sendPort'] = $sendPort;
		}

		return [
			'id' => $id,
			'name' => $read('name') !== '' ? $read('name') : ($record['title'] ?? $read('host')),
			'kind' => $kind,
			'host' => $read('host'),
			'port' => $port > 0 ? $port : self::KINDS[$kind]['port'],
			'username' => $read('username'),
			'hasSecret' => $has('password') || $has('privatekey'),
			'publicKey' => $read('publickey'),
			'options' => $options,
			'notes' => $read('notes'),
			'locked' => array_values($locked),
			'lastUsed' => $mine['lastUsed'] ?? null,
			'lastResult' => $mine['lastResult'] ?? null,
			'created' => $mine['created'] ?? null,
			'updated' => $mine['updated'] ?? null,
		];
	}

	/**
	 * One stored record as the rest of NetBase expects it: an EndpointEntity,
	 * exactly as before, so nothing downstream can tell where it came from.
	 *
	 * @param array<string, mixed> $record
	 * @param array<string, string> $map
	 */
	private function toEntity(string $userId, array $record, array $map, string $group): EndpointEntity {
		$shown = $this->present($record, $map, $this->meta($userId), $group);
		$values = (array)($record['values'] ?? []);
		$read = static function (string $slot) use ($values, $map): string {
			$key = $map[$slot] ?? '';
			// A value the master password would be needed for comes back null,
			// which is not a credential and must not be passed off as one.
			return $key === '' ? '' : (string)($values[$key] ?? '');
		};

		$entity = new EndpointEntity();
		$entity->setId((int)$shown['id']);
		$entity->setUserId($userId);
		$entity->setName((string)$shown['name']);
		$entity->setKind((string)$shown['kind']);
		$entity->setHost((string)$shown['host']);
		$entity->setPort((int)$shown['port']);
		$entity->setUsername((string)$shown['username']);
		$entity->setNotes((string)$shown['notes']);
		$entity->setOptions((string)json_encode($shown['options'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
		$entity->setLastUsed($shown['lastUsed'] === null ? null : (int)$shown['lastUsed']);
		$entity->setLastResult($shown['lastResult'] === null ? null : (string)$shown['lastResult']);

		$credentials = ['password' => $read('password'), 'key' => $read('privatekey'), 'passphrase' => $read('passphrase')];
		if ($shown['hasSecret'] && implode('', $credentials) === '') {
			// There is a credential, and it could not be read: the master
			// password has not been given. Saying that is far kinder than an
			// authentication failure from the far end.
			throw new \RuntimeException('The RegiBase master password is needed to use this connection.');
		}
		$this->carry($entity, $credentials);
		return $entity;
	}

	/**
	 * Put the credentials on the entity for the length of one request.
	 *
	 * Sealed with the instance secret purely so they are not sitting in a plain
	 * property while the entity is passed around. Nothing in this shape is ever
	 * written anywhere.
	 *
	 * @param array{password: string, key: string, passphrase: string} $credentials
	 */
	private function carry(EndpointEntity $entity, array $credentials): void {
		$entity->setSecret(implode('', $credentials) !== ''
			? $this->crypto->encrypt((string)json_encode($credentials, JSON_UNESCAPED_SLASHES))
			: null);
	}

	/** @return array<string, mixed> */
	private function readOne(string $userId, int $collectionId, int $id): array {
		foreach ($this->regibase->records($userId, $collectionId) as $record) {
			if ((int)$record['id'] === $id) {
				return $record;
			}
		}
		return ['id' => $id, 'values' => [], 'locked' => [], 'title' => ''];
	}

	/**
	 * NetBase's own notes about a connection — when it was last used and how it
	 * went. They are NetBase's bookkeeping, not the user's data, so they stay
	 * here rather than being written into somebody's collection.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	private function meta(string $userId): array {
		$stored = json_decode($this->config->getUserValue($userId, 'netbase', self::C_META, '{}'), true);
		return is_array($stored) ? $stored : [];
	}

	/** @param array<string, mixed> $fields */
	private function remember(string $userId, int $id, array $fields): void {
		if ($id <= 0) {
			return;
		}
		$meta = $this->meta($userId);
		$meta[(string)$id] = array_merge($meta[(string)$id] ?? [], $fields);
		// Notes for records that are long gone would grow without end.
		if (count($meta) > 500) {
			$meta = array_slice($meta, -500, null, true);
		}
		$this->config->setUserValue($userId, 'netbase', self::C_META, (string)json_encode($meta));
	}
}
