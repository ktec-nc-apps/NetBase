<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\AppInfo\Application;
use OCA\NetBase\Db\DeviceMapper;
use OCP\App\IAppManager;
use OCP\ICacheFactory;
use OCP\IConfig;
use OCP\IGroupManager;
use OCP\IUserManager;

/**
 * The AI assistant of NetBase, modelled on EditBase's (the owner, 2026-10-04).
 *
 * NetBase has no AI of its own: it asks AI-Hub (ai_hub), the AI gateway whose
 * key, model and limits are set once in AI-Hub's admin settings. Without AI-Hub
 * the assistant is not offered at all, and its admin settings are shown greyed out.
 *
 * The assistant runs nothing. It reads what the person already has on the screen
 * -- the current tool's result, as the browser sends it -- and, when allowed, the
 * device list, and explains them. What it may read, who may use it and whether it
 * may search the web is set by the administrator.
 */
class AiService {
	public const KEY_ENABLED = 'ai_enabled';
	public const KEY_USERS = 'ai_users';
	public const KEY_GROUPS = 'ai_groups';
	public const KEY_READ = 'ai_read';
	public const KEY_SEARCH = 'ai_search';
	/**
	 * The second tier (the owner, 2026-10-04, for managing their own infrastructure):
	 * with this on, a member of the admin group gets, through the assistant, the tools
	 * to read RegiBase, run SSH and run any shell command on this server. Off by
	 * default; nothing is ever handed to a non-administrator.
	 */
	public const KEY_ADMIN_TOOLS = 'ai_admin_tools';
	/** The person's own: how wide the assistant's column is. */
	public const KEY_WIDTH = 'ai_width';
	public const DEFAULT_WIDTH = '500px';
	/** What the assistant may be allowed to read: the screen, and the device list. */
	public const SOURCES = ['screen', 'devices'];
	/** The name the read-only, everyone's assistant is registered under at AI-Hub. */
	public const SCENARIO = 'assistant';
	/** The name the administrator's tool-carrying assistant is registered under. */
	public const SCENARIO_ADMIN = 'assistant-admin';
	/** The shell tool's hard limits. */
	private const SHELL_TIMEOUT = 60.0;
	private const TOOL_OUTPUT_LIMIT = 20000;
	private const HUB = 'ai_hub';
	private const HUB_SERVICE = '\\OCA\\AIHub\\Service\\HubService';
	/** How long the administrator's approval of one command stays good, in seconds. */
	public const APPROVAL_TTL = 300;
	/** The marker the page turns into a button: [[nb-confirm:<hash>]]. */
	public const CONFIRM_MARK = 'nb-confirm';

	public function __construct(
		private IConfig $config,
		private IAppManager $apps,
		private IGroupManager $groups,
		private IUserManager $users,
		private PermissionService $permissions,
		private DeviceMapper $devices,
		private ExecService $exec,
		private RegiBaseBridge $regibase,
		private SshService $ssh,
		private EndpointService $endpoints,
		private ICacheFactory $cacheFactory,
	) {
	}

	/** AI-Hub is installed and switched on. */
	public function hubPresent(): bool {
		return $this->apps->isEnabledForUser(self::HUB) && class_exists(self::HUB_SERVICE);
	}

	/** @return object|null AI-Hub's HubService */
	private function hub(): ?object {
		return $this->hubPresent() ? \OCP\Server::get(ltrim(self::HUB_SERVICE, '\\')) : null;
	}

	/**
	 * Tell AI-Hub what NetBase's assistant is. Called when the app boots, in every
	 * request: the hub keeps scenarios in memory only, and the request that works
	 * out an answer is not the one that asked.
	 */
	public function registerScenario(): void {
		$hub = $this->hub();
		if ($hub === null) {
			return;
		}
		// The read-only assistant everyone gets: no tools at all.
		if (!$hub->hasScenario(Application::APP_ID, self::SCENARIO)) {
			$hub->registerScenario(Application::APP_ID, self::SCENARIO, [
				'system' => AiScenario::base(),
				// Whether a question may search is decided per question, from the
				// administrator's NetBase settings; the language is in the prompt itself.
				'search' => true,
				'language' => false,
				// Who may ask is the administrator's NetBase setting, and the hub holds
				// to it on every way in -- not only through NetBase's own controller.
				'allow' => fn (string $uid): bool => $this->allowed($uid),
				'transcript' => [self::class, 'transcriptTurn'],
			]);
		}
		// The administrator's assistant, with tools. It is registered whatever the
		// setting (registration happens at boot, before any user is known), but it
		// is only ever *used* for an administrator while the setting is on (see
		// ask()), and every tool checks again, on the server, before it runs.
		if (!$hub->hasScenario(Application::APP_ID, self::SCENARIO_ADMIN)) {
			$hub->registerScenario(Application::APP_ID, self::SCENARIO_ADMIN, [
				'system' => AiScenario::baseAdmin(),
				'tools' => $this->adminTools(),
				'search' => true,
				'language' => false,
				// Only an administrator, while the tier is switched on -- the same test
				// every tool makes again before it runs; here the hub makes it first.
				'allow' => fn (string $uid): bool => $this->adminToolsAllowed($uid),
				'transcript' => [self::class, 'transcriptTurn'],
			]);
		}
	}

	/**
	 * How a turn reads in a conversation saved to Files (the owner, 2026-10-06): an
	 * answer loses the [[nb-confirm:…]] markers the page turns into buttons.
	 */
	public static function transcriptTurn(string $role, string $text): ?string {
		if ($role === 'assistant') {
			$text = (string)preg_replace('/\[\[nb-confirm:[0-9a-f]{8,64}\]\]/i', '', $text);
			$text = trim((string)preg_replace(['/[ \t]+\n/', '/\n{3,}/'], ["\n", "\n\n"], $text));
		}
		return $text !== '' ? $text : null;
	}

	/**
	 * The administrator's tools, as AI-Hub runs them: each with the rights of the
	 * web server. Every callback checks again, on the server, that the asking user
	 * is in the admin group and the setting is on -- defence in depth, independent
	 * of which scenario the model was given.
	 *
	 * @return array<string, array{description: string, input: array, run: callable}>
	 */
	private function adminTools(): array {
		$guard = function (string $uid): ?string {
			return $this->adminToolsAllowed($uid) ? null
				: 'Not allowed: administrator tools are off, or you are not an administrator.';
		};
		return [
			'regibase_read' => [
				'description' => 'Read the administrator\'s own RegiBase. With no argument, lists their collections (id, name, field labels). With a collection id, returns that collection\'s records. Fields the collection marks secret are never shown.',
				'input' => [
					'type' => 'object',
					'properties' => [
						'collection' => ['type' => 'integer', 'description' => 'The id of one collection to read the records of. Omit to list the collections.'],
						'query' => ['type' => 'string', 'description' => 'Optional words to filter rows by (matched against the shown values).'],
					],
				],
				'run' => function (string $uid, array $args) use ($guard) {
					return $guard($uid) ?? $this->runRegibaseRead($uid, $args);
				},
			],
			'ssh' => [
				'description' => 'Run one command over SSH on a host and return what it printed. The host need not be a saved connection. Give the user name and a password or the path of a private key in the administrator\'s Nextcloud files. Runs only once the administrator has approved that exact command: the first call answers NOT RUN with a marker to show them.',
				'input' => [
					'type' => 'object',
					'properties' => [
						'host' => ['type' => 'string', 'description' => 'Host name or IP address.'],
						'command' => ['type' => 'string', 'description' => 'The command to run.'],
						'username' => ['type' => 'string', 'description' => 'The user to sign in as.'],
						'password' => ['type' => 'string', 'description' => 'The password, if signing in by password.'],
						'privateKeyPath' => ['type' => 'string', 'description' => 'Path of a private key file inside the administrator\'s Nextcloud files, if signing in by key.'],
						'passphrase' => ['type' => 'string', 'description' => 'The key\'s passphrase, if it has one.'],
						'port' => ['type' => 'integer', 'description' => 'The port, if not 22.'],
					],
					'required' => ['host', 'command'],
				],
				'run' => function (string $uid, array $args) use ($guard) {
					return $guard($uid) ?? $this->runSsh($uid, $args);
				},
			],
			'shell' => [
				'description' => 'Run a shell command on this Nextcloud server, with the rights of the web server user. Returns its standard output, standard error and exit code. Runs only once the administrator has approved that exact command: the first call answers NOT RUN with a marker to show them.',
				'input' => [
					'type' => 'object',
					'properties' => [
						'command' => ['type' => 'string', 'description' => 'The command line to run (it is passed to "bash -c").'],
					],
					'required' => ['command'],
				],
				'run' => function (string $uid, array $args) use ($guard) {
					return $guard($uid) ?? $this->runShell($uid, $args);
				},
			],
		];
	}

	/**
	 * What AI-Hub can offer now.
	 *
	 * @return array{present: bool, ready: bool, reason: string, provider: string, mode: string, model: string, search: bool}
	 */
	public function hubStatus(): array {
		$hub = $this->hub();
		if ($hub === null) {
			return ['present' => false, 'ready' => false, 'reason' => 'absent', 'provider' => '', 'mode' => '', 'model' => '', 'search' => false];
		}
		// Per app: AI-Hub may give NetBase an AI and model of its own.
		return ['present' => true] + $hub->status(Application::APP_ID);
	}

	/**
	 * Whether images can go with a question now: AI-Hub checks the connection this app
	 * is given (an older AI-Hub says nothing about images, which reads as no).
	 */
	public function imagesOk(): bool {
		$hub = $this->hub();
		return $hub !== null && !empty($hub->status(Application::APP_ID)['images']);
	}

	/** @return array{enabled: bool, users: string, groups: list<string>, read: list<string>, search: bool, adminTools: bool} */
	public function settings(): array {
		$get = fn (string $k, string $d) => $this->config->getAppValue(Application::APP_ID, $k, $d);
		$groups = json_decode($get(self::KEY_GROUPS, '[]'), true);
		$read = json_decode($get(self::KEY_READ, '[]'), true);
		return [
			'enabled' => $get(self::KEY_ENABLED, 'no') === 'yes',
			'users' => $get(self::KEY_USERS, 'all') === 'groups' ? 'groups' : 'all',
			'groups' => is_array($groups) ? array_values(array_filter($groups, 'is_string')) : [],
			'read' => is_array($read) ? array_values(array_intersect(self::SOURCES, $read)) : [],
			'search' => $get(self::KEY_SEARCH, 'no') === 'yes',
			'adminTools' => $get(self::KEY_ADMIN_TOOLS, 'no') === 'yes',
		];
	}

	/** @param array{enabled?: mixed, users?: mixed, groups?: mixed, read?: mixed, search?: mixed, adminTools?: mixed} $in */
	public function saveSettings(array $in): array {
		$set = fn (string $k, string $v) => $this->config->setAppValue(Application::APP_ID, $k, $v);
		$set(self::KEY_ENABLED, !empty($in['enabled']) ? 'yes' : 'no');
		$set(self::KEY_USERS, ($in['users'] ?? '') === 'groups' ? 'groups' : 'all');
		$groups = is_array($in['groups'] ?? null) ? $in['groups'] : [];
		$groups = array_values(array_filter($groups, fn ($g) => is_string($g) && $this->groups->groupExists($g)));
		$set(self::KEY_GROUPS, json_encode($groups));
		$read = is_array($in['read'] ?? null) ? $in['read'] : [];
		$set(self::KEY_READ, json_encode(array_values(array_intersect(self::SOURCES, $read))));
		$set(self::KEY_SEARCH, !empty($in['search']) ? 'yes' : 'no');
		$set(self::KEY_ADMIN_TOOLS, !empty($in['adminTools']) ? 'yes' : 'no');
		return $this->settings();
	}

	/** Whether the administrator has switched the second, tool-carrying tier on at all. */
	public function areAdminToolsEnabled(): bool {
		return $this->config->getAppValue(Application::APP_ID, self::KEY_ADMIN_TOOLS, 'no') === 'yes';
	}

	/**
	 * Whether this user may be given the administrator's tools: in the admin group,
	 * the tier switched on, and AI-Hub there. Checked both when the scenario is
	 * chosen and, again, inside every tool before it runs.
	 */
	public function adminToolsAllowed(string $uid): bool {
		return $uid !== '' && $this->areAdminToolsEnabled() && $this->hubPresent() && $this->groups->isAdmin($uid);
	}

	/**
	 * Whether this person may use the assistant, as the administrator has set it.
	 * Someone who may use no tool in NetBase at all never sees it, whoever the
	 * administrator chose: there is nothing on their screen for it to read.
	 */
	public function allowed(string $uid): bool {
		$s = $this->settings();
		if (!$s['enabled'] || !$this->hubPresent()) {
			return false;
		}
		// For this person, not the session's: AI-Hub asks again in the request that works
		// the answer out, which has no session.
		if (!$this->permissions->canUseAnythingFor($uid)) {
			return false;
		}
		if ($s['users'] === 'all') {
			return true;
		}
		$user = $this->users->get($uid);
		if ($user === null) {
			return false;
		}
		foreach ($this->groups->getUserGroupIds($user) as $g) {
			if (in_array($g, $s['groups'], true)) {
				return true;
			}
		}
		return false;
	}

	/** The width of the assistant's column as this person keeps it: "500px" or "30%". */
	public function width(string $uid): string {
		$w = $this->config->getUserValue($uid, Application::APP_ID, self::KEY_WIDTH, self::DEFAULT_WIDTH);
		return self::validWidth($w) ?? self::DEFAULT_WIDTH;
	}

	/** Keeps the width when it is one that makes sense; says whether it was. */
	public function saveWidth(string $uid, mixed $width): bool {
		$w = is_string($width) ? self::validWidth(trim($width)) : null;
		if ($w === null) {
			return false;
		}
		$this->config->setUserValue($uid, Application::APP_ID, self::KEY_WIDTH, $w);
		return true;
	}

	/** Pixels from 240 to 1200, or a percentage of the window from 15 to 60; null otherwise. */
	public static function validWidth(string $w): ?string {
		if (!preg_match('/^(\d{1,4}(?:\.\d{1,2})?)(px|%)$/', $w, $m)) {
			return null;
		}
		$n = (float)$m[1];
		if (($m[2] === 'px' && $n >= 240 && $n <= 1200) || ($m[2] === '%' && $n >= 15 && $n <= 60)) {
			return $w;
		}
		return null;
	}

	/**
	 * What may be read for this person: the screen as the administrator allows
	 * it, the device list only when they may use the Devices tool too.
	 *
	 * @return list<string>
	 */
	private function readFor(string $uid): array {
		$read = $this->settings()['read'];
		if ($this->permissions->uid() !== $uid || !$this->permissions->can('devices')) {
			$read = array_values(array_diff($read, ['devices']));
		}
		return $read;
	}

	/**
	 * What the page needs to know: whether to show the handle at all, whether a
	 * question can be asked now, what the assistant may read, how wide it is.
	 */
	public function status(string $uid): array {
		if (!$this->allowed($uid)) {
			return ['show' => false];
		}
		$hub = $this->hubStatus();
		$s = $this->settings();
		return [
			'show' => true,
			'ready' => $hub['ready'],
			'reason' => $hub['reason'],
			'model' => $hub['model'],
			'read' => $this->readFor($uid),
			'search' => $s['search'] && $hub['search'],
			'width' => $this->width($uid),
			// whether the person may paste or drop images into a question
			'images' => $this->imagesOk(),
			// Only to change the panel's subtitle for an administrator with the
			// second tier on; it hands no power out, the server decides that.
			'adminTools' => $this->adminToolsAllowed($uid),
		];
	}

	/**
	 * Ask the assistant. What the administrator allows and what is on the screen
	 * are put into the prompt here, on the server; the browser sends only the
	 * conversation and the text of the current tool's result. The device list is
	 * added here, never sent by the browser.
	 *
	 * @param list<array{role: string, text: string, images?: int}> $history
	 * @param array<string, mixed> $context
	 * @param string $conversation A token that lets AI-Hub remember this conversation across reloads (empty = stateless).
	 * @param list<array{type: string, data: string}> $images Pasted or dropped into the question; AI-Hub checks them (kind, size, number).
	 * @return array{id?: string, error?: string}
	 */
	public function ask(string $uid, array $history, string $message, array $context, string $lang, string $conversation = '', array $images = []): array {
		if (!$this->allowed($uid)) {
			return ['error' => 'not-allowed'];
		}
		$images = array_values(array_filter($images, 'is_array'));
		if ($images !== [] && !$this->imagesOk()) {
			return ['error' => 'no-images'];
		}
		$st = $this->status($uid);
		// A turn that had images says how many ('images' => n); AI-Hub puts a mark in their place.
		$messages = array_map(static fn (array $t) => ['role' => $t['role'], 'text' => $t['text']] + (is_int($t['images'] ?? null) && $t['images'] > 0 ? ['images' => min($t['images'], 99)] : []),
			array_slice(array_values(array_filter($history, static fn ($t) => is_array($t)
			&& in_array($t['role'] ?? '', ['user', 'assistant'], true) && is_string($t['text'] ?? null))), -30));
		$messages[] = ['role' => 'user', 'text' => $message];
		$ctx = [
			'tab' => is_string($context['tab'] ?? null) ? mb_substr($context['tab'], 0, 40) : '',
			'label' => is_string($context['label'] ?? null) ? mb_substr($context['label'], 0, 80) : '',
			'text' => is_string($context['text'] ?? null) ? $context['text'] : '',
		];
		if (in_array('devices', $st['read'], true)) {
			$ctx['devices'] = $this->deviceList();
		}
		$this->registerScenario();
		// An administrator, with the second tier on, gets the tool-carrying
		// scenario; everyone else always gets the read-only one, tools and all
		// kept out of its very prompt.
		$scenario = $this->adminToolsAllowed($uid) ? self::SCENARIO_ADMIN : self::SCENARIO;
		$options = [
			'context' => AiScenario::perQuestion($st['read'], $st['search'], $ctx, $lang),
			'search' => $st['search'],
			// The browser keeps one token per conversation, so the hub remembers the
			// exchange across page reloads; both scenarios share it, keyed per user.
			'conversation' => $conversation,
		];
		if ($images !== []) {
			$options['images'] = $images;
		}
		return $this->hub()->ask($uid, Application::APP_ID, $scenario, $messages, $options);
	}

	/**
	 * Drop the server-side memory of one conversation (the panel's "New
	 * conversation"). AI-Hub scopes the token to this user, so a person can only
	 * clear their own.
	 */
	public function forget(string $uid, string $conversation): void {
		if (!$this->allowed($uid) || $conversation === '') {
			return;
		}
		$hub = $this->hub();
		if ($hub !== null) {
			$hub->forgetConversation($uid, Application::APP_ID, $conversation);
		}
	}

	/**
	 * The device list as the assistant may see it: what a device is and where,
	 * never the notes (they are where people write passwords) and nothing from
	 * the saved connections.
	 *
	 * @return list<array<string, mixed>>
	 */
	private function deviceList(): array {
		$out = [];
		foreach ($this->devices->findAll(AiScenario::DEVICE_LIMIT) as $d) {
			$j = $d->jsonSerialize();
			$place = trim(implode(' ', array_filter([(string)($j['location'] ?? ''), (string)($j['room'] ?? '')])));
			$out[] = [
				'id' => $j['id'],
				'ip' => $j['ip'],
				'hostname' => $j['hostname'],
				'name' => $j['name'],
				'vendor' => $j['vendor'],
				'type' => $j['type'],
				'ports' => $j['ports'],
				'location' => $place,
				'online' => $j['online'],
			];
		}
		return $out;
	}

	// ---- approval of a command before it runs -----------------------------------
	//
	// A command the model wants to run through ssh or shell is not run on the
	// model's say-so. What the model writes can be steered by what it has read:
	// the device list carries names taken from mDNS and NetBIOS, and a host's
	// output can say anything. So the word that lets a command run has to be the
	// administrator's own. The tool answers "not run" with a marker naming the
	// exact command; the page shows the marker as a button; pressing it sends
	// "approve <hash>" as the person's own message, which AiController records
	// here before the model ever sees it; the model then calls the tool again
	// and finds the approval waiting (review 2026-10-04, medium 8).

	private function approvals(): \OCP\ICache {
		return $this->cacheFactory->createDistributed('netbase-ai');
	}

	/** The name of one exact command, as the approval knows it. */
	public static function confirmHash(string $kind, string $what): string {
		return substr(hash('sha256', $kind . "\0" . $what), 0, 16);
	}

	/** The administrator approved, in a message of their own, the command with this hash. */
	public function approve(string $uid, string $hash): bool {
		if (!$this->adminToolsAllowed($uid) || preg_match('/^[0-9a-f]{16}$/', $hash) !== 1) {
			return false;
		}
		$this->approvals()->set('approve_' . $uid . '_' . $hash, 1, self::APPROVAL_TTL);
		return true;
	}

	/** Whether this exact command was approved. An approval is spent by the one run it allows. */
	private function takeApproval(string $uid, string $hash): bool {
		$cache = $this->approvals();
		$key = 'approve_' . $uid . '_' . $hash;
		if ($cache->get($key) === null) {
			return false;
		}
		$cache->remove($key);
		return true;
	}

	/**
	 * What a refused tool call answers: the marker for the page and the
	 * instructions for the model. The command is also noted as pending, so the
	 * marker reaches the page even when the model leaves it out of its answer.
	 */
	private function needsApproval(string $uid, string $hash, string $shown): string {
		$cache = $this->approvals();
		$pending = $cache->get('pending_' . $uid);
		$pending = is_array($pending) ? $pending : [];
		$pending[$hash] = mb_substr($shown, 0, 500);
		$cache->set('pending_' . $uid, $pending, self::APPROVAL_TTL);
		return "NOT RUN. The administrator must approve this exact command before it runs.\n"
			. 'In your answer, quote the command below so the administrator can read it, and put this marker on a line of its own, exactly as written: [[' . self::CONFIRM_MARK . ':' . $hash . "]]\n"
			. 'The page turns the marker into a button; the administrator approves by pressing it, which sends the message "approve ' . $hash . "\". Then call this tool again with exactly the same arguments.\n"
			. 'command: ' . $shown;
	}

	/** The markers of commands still waiting for approval, added when the model left them out of its answer. */
	private function withMarkers(string $uid, string $text): string {
		$cache = $this->approvals();
		$pending = $cache->get('pending_' . $uid);
		if (!is_array($pending) || $pending === []) {
			return $text;
		}
		$cache->remove('pending_' . $uid);
		foreach ($pending as $hash => $shown) {
			$mark = '[[' . self::CONFIRM_MARK . ':' . $hash . ']]';
			if (!str_contains($text, $mark)) {
				$text .= "\n\n" . $shown . "\n" . $mark;
			}
		}
		return $text;
	}

	// ---- the administrator's tools (run with the rights of the web server) -------
	// Each is entered only after adminToolsAllowed() has been checked again in
	// adminTools(); none of them touches PermissionService, and none is reachable
	// by anyone but an administrator while the tier is on. ssh and shell run
	// nothing until the administrator has approved the exact command (above).

	/**
	 * Read the administrator's own RegiBase. Secret fields are never shown: whatever
	 * the collection marks secret is dropped before the model sees a row, whether or
	 * not the master password happens to be in this session.
	 *
	 * @param array<string, mixed> $args
	 */
	private function runRegibaseRead(string $uid, array $args): string {
		if (!$this->regibase->available()) {
			return 'RegiBase is not installed on this server.';
		}
		$collections = $this->regibase->collections($uid);
		$cid = isset($args['collection']) ? (int)$args['collection'] : 0;
		if ($cid <= 0) {
			if ($collections === []) {
				return 'This account has no RegiBase collections.';
			}
			$lines = ['The administrator\'s RegiBase collections:'];
			foreach ($collections as $c) {
				$fields = array_map(static fn ($f) => $f['label'] . ($f['secret'] ? ' (secret)' : ''), $c['fields']);
				$lines[] = '- [' . $c['id'] . '] ' . $c['name'] . ' (' . $c['records'] . ' records): ' . implode(', ', $fields);
			}
			return implode("\n", $lines);
		}
		$meta = null;
		foreach ($collections as $c) {
			if ($c['id'] === $cid) {
				$meta = $c;
				break;
			}
		}
		if ($meta === null) {
			return 'No collection with id ' . $cid . ' belongs to this account.';
		}
		$secretKeys = [];
		foreach ($meta['fields'] as $f) {
			if ($f['secret']) {
				$secretKeys[$f['key']] = true;
			}
		}
		$query = isset($args['query']) && is_string($args['query']) ? mb_strtolower(trim($args['query'])) : '';
		$lines = ['Records of "' . $meta['name'] . '" (secret fields are not shown):'];
		$shown = 0;
		foreach ($this->regibase->records($uid, $cid) as $r) {
			$pairs = [];
			foreach ($r['values'] as $key => $value) {
				if (isset($secretKeys[$key])) {
					$pairs[] = $key . '=(secret — not shown)';
					continue;
				}
				$pairs[] = $key . '=' . (is_string($value) ? $value : ($value === null ? '' : (string)$value));
			}
			$row = ($r['title'] !== '' ? $r['title'] . ' — ' : '') . implode(' | ', $pairs);
			if ($query !== '' && !str_contains(mb_strtolower($row), $query)) {
				continue;
			}
			$lines[] = '- ' . $row;
			if (++$shown >= 200) {
				$lines[] = '… (more rows not shown)';
				break;
			}
		}
		if ($shown === 0) {
			$lines[] = $query !== '' ? '(no rows matched)' : '(no rows)';
		}
		return mb_substr(implode("\n", $lines), 0, self::TOOL_OUTPUT_LIMIT);
	}

	/**
	 * Run one command over SSH on any host, with credentials the model was given.
	 * Not limited to saved connections (the owner's instruction).
	 *
	 * @param array<string, mixed> $args
	 */
	private function runSsh(string $uid, array $args): string {
		$host = trim((string)($args['host'] ?? ''));
		$command = (string)($args['command'] ?? '');
		if ($host === '' || trim($command) === '') {
			return 'Both a host and a command are needed.';
		}
		// Who, where and what, as the administrator will read it; the approval
		// is for exactly this and nothing else.
		$username = (string)($args['username'] ?? '');
		$port = (int)($args['port'] ?? 0);
		$shown = 'ssh ' . ($username !== '' ? $username . '@' : '') . $host . ($port > 0 ? ':' . $port : '') . ': ' . $command;
		$hash = self::confirmHash('ssh', $shown);
		if (!$this->takeApproval($uid, $hash)) {
			return $this->needsApproval($uid, $hash, $shown);
		}
		try {
			$endpoint = $this->endpoints->transient($uid, [
				'kind' => 'ssh',
				'host' => $host,
				'port' => (int)($args['port'] ?? 0),
				'username' => (string)($args['username'] ?? ''),
				'secret' => (string)($args['password'] ?? ''),
				'privateKeyPath' => (string)($args['privateKeyPath'] ?? ''),
				'passphrase' => (string)($args['passphrase'] ?? ''),
			]);
			$r = $this->ssh->run($endpoint, $command);
		} catch (\Throwable $e) {
			return 'SSH failed: ' . $e->getMessage();
		}
		$out = 'host: ' . ($r['host'] ?? $host) . "\nexit status: " . ($r['exitStatus'] ?? '?')
			. "\noutput:\n" . (string)($r['output'] ?? '');
		return mb_substr($out, 0, self::TOOL_OUTPUT_LIMIT);
	}

	/**
	 * Run a shell command on this server, with the rights of the web server user.
	 * The same reach as Talk-Bot's administrator CLI: whatever www-data can do.
	 *
	 * @param array<string, mixed> $args
	 */
	private function runShell(string $uid, array $args): string {
		$command = trim((string)($args['command'] ?? ''));
		if ($command === '') {
			return 'No command given.';
		}
		$hash = self::confirmHash('shell', $command);
		if (!$this->takeApproval($uid, $hash)) {
			return $this->needsApproval($uid, $hash, $command);
		}
		$r = $this->exec->run('bash', ['-c', $command], self::SHELL_TIMEOUT, 2_000_000);
		$parts = ['exit code: ' . (int)($r['code'] ?? -1)];
		$stdout = (string)($r['stdout'] ?? '');
		$stderr = (string)($r['stderr'] ?? '');
		$parts[] = "stdout:\n" . ($stdout !== '' ? $stdout : '(empty)');
		if ($stderr !== '') {
			$parts[] = "stderr:\n" . $stderr;
		}
		return mb_substr(implode("\n", $parts), 0, self::TOOL_OUTPUT_LIMIT);
	}

	/** @return array{state: string, text?: string, error?: string} */
	public function result(string $uid, string $id): array {
		$hub = $this->hub();
		$out = $hub === null ? ['state' => 'unknown'] : $hub->result($uid, $id);
		if (($out['state'] ?? '') === 'done') {
			// A command refused for want of approval reaches the page as its
			// marker whether or not the model repeated it.
			$out['text'] = $this->withMarkers($uid, (string)($out['text'] ?? ''));
		}
		return $out;
	}
}
