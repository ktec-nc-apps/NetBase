<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\AppInfo\Application;
use OCA\NetBase\Db\DeviceEntity;
use OCA\NetBase\Db\DeviceMapper;
use OCP\IConfig;
use OCP\L10N\IFactory;

/**
 * What the assistant can do in NetBase's own records by itself (the owner, 2026-11-07:
 * "RegiBase の中は自由に AI が操作できるようにしろ" -- and the same for the other apps).
 *
 * The records are the device list: the assistant reads it, and where the administrator allows
 * it, adds a device by its address, names it, places it, tags it and removes it. A device's
 * notes are never read or written: people keep passwords and keys in them.
 * Each tool is checked against the asking person's own NetBase rights, the same ones the page
 * asks for: reading the list is the "Devices" tool, changing it is "Scanning" ("sweep the
 * network and edit the device list").
 *
 * Nothing here reaches the network: no scan, no ping, no probe, no Wake-on-LAN, no command on a
 * device. A device added here is written as given and starts out offline until a scan sees it.
 * The administrator's shell and SSH tools (the second tier) are separate and unchanged.
 */
class AiTools {
	// Refusals here are \DomainException: their words go to the model, which says them in the
	// person's language; they are never shown on a screen, so they are not in l10n.

	/** The most characters a tool hands back. */
	private const OUT_MAX = 60000;
	/** What a device row says, as the tools show and take it. */
	private const EDITABLE = ['label', 'tags', 'known', 'type', 'location', 'room', 'mount', 'wake_mac'];

	public function __construct(
		private DeviceMapper $devices,
		private PermissionService $permissions,
		private IConfig $config,
		private IFactory $l10nFactory,
	) {
	}

	/** NetBase's words in the person's own language (the tools run without their session). */
	private function l(string $uid = ''): \OCP\IL10N {
		$lang = $uid !== '' ? $this->config->getUserValue($uid, 'core', 'lang', '') : '';
		return $lang !== '' ? $this->l10nFactory->get(Application::APP_ID, $lang) : $this->l10nFactory->get(Application::APP_ID);
	}

	/**
	 * What a change did, for "What was actually done" under the answer (AI-Hub 0.1.5 keeps it
	 * from the call itself): "label — n: names", made from the rows, never from the model's words.
	 */
	public static function report(string $label, array $names, int $n = -1): string {
		$n = $n < 0 ? count($names) : $n;
		$names = array_values(array_filter(array_map(fn ($x) => trim((string)$x), $names), fn ($x) => $x !== ''));
		$shown = array_slice($names, 0, 20);
		return $label . ' — ' . $n . ($shown !== [] ? ': ' . implode(', ', $shown) . (count($names) > 20 ? ', …' : '') : '');
	}

	private static function nameOf(DeviceEntity $d): string {
		$name = (string)($d->getLabel() ?: ($d->getHostname() ?: ''));
		$ip = (string)($d->getIp() ?? '');
		return $name !== '' && $ip !== '' && $name !== $ip ? $name . ' (' . $ip . ')' : ($name !== '' ? $name : $ip);
	}

	/**
	 * The tools, as AI-Hub takes them.
	 *
	 * @param callable(): list<string> $allowed What the administrator allows (AiService::SOURCES).
	 */
	public function tools(callable $allowed): array {
		$wrap = function (string $need, string $tool, callable $fn) use ($allowed): callable {
			return function (string $uid, array $args) use ($need, $tool, $fn, $allowed) {
				if (!in_array($need, $allowed(), true)) {
					$out = ['error' => $need === 'write'
						? 'The administrator has not allowed the assistant to change anything in NetBase.'
						: 'The administrator has not allowed the assistant to read the device list.'];
				} elseif (!$this->permissions->canFor($uid, $tool)) {
					$out = ['error' => $tool === 'scan'
						? 'The person asking may not edit the device list in NetBase (the administrator gives that with "Scanning").'
						: 'The person asking may not see the device list in NetBase (the administrator gives that with "Devices").'];
				} else {
					try {
						$out = $fn($uid, $args);
					} catch (\DomainException $e) {
						$out = ['error' => $e->getMessage()];
					}
				}
				$json = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
				return mb_strlen($json) > self::OUT_MAX ? mb_substr($json, 0, self::OUT_MAX) . ' …(cut: ask for fewer, or use offset)' : $json;
			};
		};
		$change = ['type' => 'object', 'properties' => [
			'label' => ['type' => 'string', 'description' => 'The name the person gives it ("" clears it).'],
			'tags' => ['type' => 'string', 'description' => 'Comma-separated tags ("" clears them).'],
			'known' => ['type' => 'boolean', 'description' => 'Marked as a known device.'],
			'type' => ['type' => 'string', 'description' => 'The kind of device, e.g. router, switch, printer, nas, camera, pc, phone, tv, or the person\'s own word; "unknown" hands it back to the scans\' guess.'],
			'location' => ['type' => 'string', 'description' => 'The floor or place.'],
			'room' => ['type' => 'string'],
			'mount' => ['type' => 'string', 'description' => 'Where in the room it is installed.'],
			'wake_mac' => ['type' => 'string', 'description' => 'A MAC for Wake-on-LAN, typed by hand ("" clears it).'],
		]];
		$l = $this->l();
		return [
			'list_devices' => [
				'kind' => 'read',
				'label' => $l->t('Look at the device list'),
				'description' => 'The device list NetBase has built of the local network: id, name, IPv4, MAC, vendor, type, ports, tags, place (location, room, mount), Wake-on-LAN MAC, online, known, first and last seen. query: words that must all appear (case ignored); online: only those online (true) or offline (false). Up to limit (default 300, at most 1000) from offset.',
				'input' => ['type' => 'object', 'properties' => ['query' => ['type' => 'string'], 'online' => ['type' => 'boolean'],
					'limit' => ['type' => 'integer'], 'offset' => ['type' => 'integer']]],
				'run' => $wrap('devices', 'devices', fn ($uid, $a) => $this->listDevices($a)),
			],
			'update_devices' => [
				'kind' => 'update',
				'label' => $l->t('Change devices'),
				'description' => 'Change devices in the list: updates is a list of {id, and any of label, tags, known, type, location, room, mount, wake_mac}; only what is given changes. Up to 300 at once. This changes NetBase\'s record only; nothing is sent to the device.',
				'input' => ['type' => 'object', 'properties' => ['updates' => ['type' => 'array', 'items' => [
					'type' => 'object', 'properties' => ['id' => ['type' => 'integer']] + $change['properties'], 'required' => ['id']]]], 'required' => ['updates']],
				'run' => $wrap('write', 'scan', fn ($uid, $a) => $this->updateDevices($uid, (array)$a['updates'])),
			],
			'add_device' => [
				'kind' => 'create',
				'label' => $l->t('Add a device'),
				'description' => 'Add a device to the list by its IPv4 address on the local network, with what is known of it (label, mac for Wake-on-LAN, tags, type, location, room, mount). Nothing is sent to the device: it starts out offline until a scan sees it. An address already on the list updates that row instead.',
				'input' => ['type' => 'object', 'properties' => ['ip' => ['type' => 'string'], 'mac' => ['type' => 'string']] + $change['properties'], 'required' => ['ip']],
				'run' => $wrap('write', 'scan', fn ($uid, $a) => $this->addDevice($uid, $a)),
			],
			'delete_devices' => [
				'kind' => 'delete',
				'label' => $l->t('Remove devices'),
				'description' => 'Remove devices from the list by id. This cannot be undone (a scan finds a device that is still there again, without its name, place and notes).',
				'input' => ['type' => 'object', 'properties' => ['ids' => ['type' => 'array', 'items' => ['type' => 'integer']]], 'required' => ['ids']],
				'run' => $wrap('write', 'scan', fn ($uid, $a) => $this->deleteDevices($uid, array_map('intval', (array)$a['ids']))),
			],
		];
	}

	private static function out(DeviceEntity $d): array {
		$j = $d->jsonSerialize();
		// notes are never read: people keep passwords and keys in them (the admin setting promises it)
		unset($j['key'], $j['extra'], $j['sources'], $j['interface'], $j['notes']);
		foreach (['firstSeen', 'lastSeen'] as $k) {
			$j[$k] = $j[$k] ? date('Y-m-d H:i', (int)$j[$k]) : null;
		}
		return array_filter($j, fn ($v) => $v !== null && $v !== '' && $v !== []);
	}

	private function listDevices(array $a): array {
		$rows = array_map([self::class, 'out'], $this->devices->findAll());
		if (array_key_exists('online', $a) && is_bool($a['online'])) {
			$rows = array_values(array_filter($rows, fn ($r) => !empty($r['online']) === $a['online']));
		}
		$words = array_filter(explode(' ', mb_strtolower(trim((string)preg_replace('/\s+/u', ' ', (string)($a['query'] ?? ''))))));
		if ($words !== []) {
			$rows = array_values(array_filter($rows, function ($r) use ($words) {
				$text = mb_strtolower(json_encode($r, JSON_UNESCAPED_UNICODE));
				foreach ($words as $w) {
					if (!str_contains($text, $w)) {
						return false;
					}
				}
				return true;
			}));
		}
		$limit = max(1, min(1000, (int)($a['limit'] ?? 300)));
		$offset = max(0, (int)($a['offset'] ?? 0));
		return ['total' => count($rows), 'offset' => $offset, 'devices' => array_slice($rows, $offset, $limit)];
	}

	/** The same cleaning the page's edit dialog gets (ApiController::updateDevice). */
	private function apply(DeviceEntity $d, array $u): void {
		$oneLine = fn (string $v): string => trim((string)preg_replace('/\s+/u', ' ', (string)preg_replace('/[\x00-\x1F\x7F]/u', ' ', $v)));
		foreach (['label' => 'setLabel', 'tags' => 'setTags'] as $k => $set) {
			if (array_key_exists($k, $u) && is_scalar($u[$k])) {
				$v = $oneLine((string)$u[$k]);
				$d->$set($v !== '' ? mb_substr($v, 0, 255) : null);
			}
		}
		foreach (['location' => 'setLocation', 'room' => 'setRoom', 'mount' => 'setMount'] as $k => $set) {
			if (array_key_exists($k, $u) && is_scalar($u[$k])) {
				$v = $oneLine((string)$u[$k]);
				$d->$set($v !== '' ? mb_substr($v, 0, 255) : null);
			}
		}
		if (array_key_exists('wake_mac', $u) && is_scalar($u['wake_mac'])) {
			$raw = trim((string)$u['wake_mac']);
			$norm = $raw === '' ? null : WakeService::normalizeMac($raw);
			if ($raw !== '' && $norm === null) {
				throw new \DomainException('"' . $raw . '" is not a MAC address such as aa:bb:cc:dd:ee:ff.');
			}
			$d->setWakeMac($norm);
		}
		if (array_key_exists('known', $u) && is_bool($u['known'])) {
			$d->setKnown($u['known']);
		}
		if (array_key_exists('type', $u) && is_scalar($u['type'])) {
			$t = mb_substr(trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', (string)$u['type'])), 0, 32);
			if ($t !== '' && $t !== (string)$d->getDtype()) {
				$d->setDtype($t);
				ScanService::markTypeChosen($d, $t === 'unknown' ? null : $t);
			}
		}
	}

	private function updateDevices(string $uid, array $updates): array {
		if (count($updates) > 300) {
			throw new \DomainException('At most 300 devices at once.');
		}
		$done = [];
		$names = [];
		$failed = [];
		foreach ($updates as $u) {
			$id = (int)($u['id'] ?? 0);
			$d = $id > 0 ? $this->devices->find($id) : null;
			if ($d === null) {
				$failed[] = ['id' => $id, 'why' => 'no such device'];
				continue;
			}
			try {
				$this->apply($d, array_intersect_key((array)$u, array_flip(self::EDITABLE)));
				$this->devices->update($d);
				$done[] = $id;
				$names[] = self::nameOf($d);
			} catch (\DomainException $e) {
				$failed[] = ['id' => $id, 'why' => $e->getMessage()];
			}
		}
		$l = $this->l($uid);
		return ['updated' => count($done), 'ids' => $done, 'failed' => $failed,
			'_report' => self::report($l->t('Change devices'), $names) . ($failed !== [] ? ' / ' . $l->t('Failed') . ' — ' . count($failed) : '')];
	}

	private function addDevice(string $uid, array $a): array {
		$ip = trim((string)($a['ip'] ?? ''));
		if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
			throw new \DomainException('Give an IPv4 address, such as 192.168.1.20.');
		}
		// the same rule as the page: an address on the local network only (no packet is sent)
		if (!\OCP\Server::get(DiscoveryService::class)->isLocalTarget($ip)) {
			throw new \DomainException('Only an address on the local network can be added (a private range, or a network this server is on).');
		}
		$was = $this->devices->findByIp($ip);
		$d = \OCP\Server::get(ScanService::class)->upsert($ip, null, ['source' => 'manual', 'present' => false]);
		$u = array_intersect_key($a, array_flip(self::EDITABLE));
		if (is_string($a['mac'] ?? null) && trim($a['mac']) !== '' && !isset($u['wake_mac'])) {
			$u['wake_mac'] = $a['mac'];
		}
		$this->apply($d, $u);
		$d = $this->devices->update($d);
		$l = $this->l($uid);
		return [$was !== null ? 'updated' : 'added' => (int)$d->getId(), 'device' => self::out($d),
			'_report' => self::report($was !== null ? $l->t('Change devices') : $l->t('Add a device'), [self::nameOf($d)])];
	}

	private function deleteDevices(string $uid, array $ids): array {
		$done = [];
		$names = [];
		$missing = [];
		foreach ($ids as $id) {
			$d = $id > 0 ? $this->devices->find($id) : null;
			if ($d !== null) {
				$names[] = self::nameOf($d);
				$this->devices->deleteById($id);
				$done[] = $id;
			} else {
				$missing[] = $id;
			}
		}
		$l = $this->l($uid);
		return ['deleted' => count($done), 'ids' => $done, 'not_found' => $missing,
			'_report' => self::report($l->t('Remove devices'), $names, count($done)) . ($missing !== [] ? ' / ' . $l->t('Failed') . ' — ' . count($missing) : '')];
	}
}
