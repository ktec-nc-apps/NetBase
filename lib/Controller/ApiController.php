<?php

declare(strict_types=1);

namespace OCA\NetBase\Controller;

use OCA\NetBase\AppInfo\Application;
use OCA\NetBase\Db\DeviceMapper;
use OCA\NetBase\Db\ScanMapper;
use OCA\NetBase\Service\BenchmarkService;
use OCA\NetBase\Service\BrowserService;
use OCA\NetBase\Service\DiscoveryService;
use OCA\NetBase\Service\DnsService;
use OCA\NetBase\Service\EndpointService;
use OCA\NetBase\Service\ExecService;
use OCA\NetBase\Service\MailService;
use OCA\NetBase\Service\ProbeService;
use OCA\NetBase\Service\SshService;
use OCA\NetBase\Service\TransferService;
use OCA\NetBase\Service\NmapService;
use OCA\NetBase\Service\OuiService;
use OCA\NetBase\Service\PermissionService;
use OCA\NetBase\Service\RequirementsService;
use OCA\NetBase\Service\ScanService;
use OCA\NetBase\Service\ToolService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IConfig;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

class ApiController extends Controller {
	public function __construct(
		IRequest $request,
		private DiscoveryService $discovery,
		private ScanService $scanService,
		private ToolService $tools,
		private NmapService $nmap,
		private BenchmarkService $bench,
		private RequirementsService $requirements,
		private EndpointService $endpoints,
		private TransferService $transfer,
		private MailService $mail,
		private ProbeService $probe,
		private SshService $ssh,
		private DnsService $dnsService,
		private BrowserService $browser,
		private OuiService $oui,
		private ExecService $exec,
		private PermissionService $permissions,
		private DeviceMapper $devices,
		private ScanMapper $scans,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/** Wrap a handler so a validation or permission failure becomes a clean JSON error. */
	private function guard(callable $handler, string $tool): JSONResponse {
		try {
			$this->permissions->require($tool);
			return new JSONResponse($handler());
		} catch (\InvalidArgumentException $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		} catch (\RuntimeException $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_FORBIDDEN);
		} catch (\Throwable $e) {
			$this->logger->error('NetBase: ' . $e->getMessage(), ['exception' => $e, 'app' => 'netbase']);
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_INTERNAL_SERVER_ERROR);
		}
	}

	/** The signed-in user, or a clean error for an endpoint that stores things. */
	private function uid(): string {
		$uid = $this->permissions->uid();
		if ($uid === null) {
			throw new \RuntimeException('Not signed in');
		}
		return $uid;
	}

	/**
	 * Saved connections are shared plumbing for the mail and file tools, so a
	 * user who may use either one may manage them.
	 *
	 * @param list<string> $tools
	 */
	private function guardAny(callable $handler, array $tools): JSONResponse {
		foreach ($tools as $tool) {
			if ($this->permissions->can($tool)) {
				return $this->guard($handler, $tool);
			}
		}
		return $this->guard($handler, $tools[0]);
	}

	// ---------------------------------------------------------------- status

	#[NoAdminRequired]
	public function status(): JSONResponse {
		$binaries = [];
		foreach (['nmap', 'ping', 'traceroute', 'tracepath', 'whois', 'dig', 'arp-scan', 'avahi-browse', 'ss', 'netstat', 'snmpwalk', 'nbtscan', 'mtr'] as $binary) {
			$binaries[$binary] = $this->exec->available($binary);
		}
		return new JSONResponse([
			'version' => $this->config->getAppValue('netbase', 'installed_version', ''),
			'can' => $this->permissions->permissions(),
			'canScan' => $this->permissions->can('scan'),
			'isAdmin' => $this->permissions->isAdmin(),
			'interfaces' => $this->permissions->can('scan') ? $this->discovery->interfaces() : [],
			'defaultRoute' => $this->permissions->can('scan') ? $this->discovery->defaultRoute() : [],
			'targets' => $this->permissions->can('scan') ? $this->discovery->suggestedTargets() : [],
			'binaries' => $binaries,
			'ouiEntries' => $this->oui->count(),
			'nmap' => $this->permissions->can('nmap') ? $this->nmap->status() : ['available' => false],
			'fingerprintPorts' => DiscoveryService::FINGERPRINT_PORTS,
			'neighbourLimits' => $this->discovery->neighbourLimits(),
			'neighbourCount' => $this->discovery->neighbourCount(),
			'sockets' => extension_loaded('sockets'),
			'procOpen' => function_exists('proc_open'),
			'sshPresets' => SshService::PRESETS,
			'preview' => $this->permissions->can('preview') && $this->browser->available(),
			'transfer' => $this->transfer->capabilities(),
		]);
	}

	// ---------------------------------------------------------------- devices

	#[NoAdminRequired]
	public function devices(): JSONResponse {
		return $this->guard(fn () => ['devices' => array_map(
			static fn ($d) => $d->jsonSerialize(),
			$this->devices->findAll()
		)], 'devices');
	}

	#[NoAdminRequired]
	public function updateDevice(int $id, ?string $label = null, ?string $tags = null, ?string $notes = null, ?bool $known = null, ?string $dtype = null): JSONResponse {
		return $this->guard(function () use ($id, $label, $tags, $notes, $known, $dtype) {
			$device = $this->devices->find($id);
			if ($device === null) {
				throw new \InvalidArgumentException('Device not found');
			}
			if ($label !== null) {
				$device->setLabel($label !== '' ? mb_substr($label, 0, 255) : null);
			}
			if ($tags !== null) {
				$device->setTags($tags !== '' ? mb_substr($tags, 0, 255) : null);
			}
			if ($notes !== null) {
				$device->setNotes($notes !== '' ? $notes : null);
			}
			if ($known !== null) {
				$device->setKnown($known);
			}
			if ($dtype !== null && $dtype !== '') {
				$device->setDtype(mb_substr($dtype, 0, 32));
			}
			return ['device' => $this->devices->update($device)->jsonSerialize()];
		}, 'scan');
	}

	#[NoAdminRequired]
	public function deleteDevice(int $id): JSONResponse {
		return $this->guard(function () use ($id) {
			$this->devices->deleteById($id);
			return ['deleted' => $id];
		}, 'scan');
	}

	// ---------------------------------------------------------------- scanning

	#[NoAdminRequired]
	public function scanAdvice(array $targets = []): JSONResponse {
		return $this->guard(fn () => $this->scanService->neighbourAdvice(
			$targets !== [] ? $targets : array_column($this->discovery->suggestedTargets(), 'cidr')
		), 'scan');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	public function scanStart(array $targets = [], array $options = []): JSONResponse {
		return $this->guard(function () use ($targets, $options) {
			$scan = $this->scanService->start($this->permissions->uid(), $targets, $options);
			return ['scan' => $scan->jsonSerialize()];
		}, 'scan');
	}

	#[NoAdminRequired]
	public function scanStep(int $id): JSONResponse {
		return $this->guard(fn () => $this->scanService->step($id), 'scan');
	}

	#[NoAdminRequired]
	public function scanCancel(int $id): JSONResponse {
		return $this->guard(function () use ($id) {
			$this->scanService->cancel($id);
			return ['cancelled' => $id];
		}, 'scan');
	}

	#[NoAdminRequired]
	public function scanHistory(): JSONResponse {
		return $this->guard(fn () => ['scans' => array_map(
			static fn ($s) => $s->jsonSerialize(),
			$this->scans->recent()
		)], 'scan');
	}

	// ---------------------------------------------------------------- tools

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function whois(string $query): JSONResponse {
		return $this->guard(fn () => $this->tools->whois($query), 'whois');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 120, period: 60)]
	public function dns(string $host, array $types = []): JSONResponse {
		return $this->guard(fn () => $this->tools->dns($host, $types), 'dns');
	}

	#[NoAdminRequired]
	public function reverse(string $ip): JSONResponse {
		return $this->guard(fn () => $this->tools->reverseLookup($ip), 'dns');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function ping(string $host, int $count = 4, bool $ipv6 = false): JSONResponse {
		return $this->guard(fn () => $this->tools->ping($host, $count, $ipv6), 'ping');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 20, period: 60)]
	public function traceroute(string $host, int $maxHops = 20): JSONResponse {
		return $this->guard(fn () => $this->tools->traceroute($host, $maxHops), 'ping');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function ports(string $host, array $ports = [], string $spec = ''): JSONResponse {
		return $this->guard(function () use ($host, $ports, $spec) {
			// A typed range ("22,80,8000-8010") beats ticking boxes when someone
			// already knows what they are looking for.
			$list = $spec !== '' ? $this->tools->expandPorts($spec) : $ports;
			return $this->tools->portCheck($host, $list !== [] ? $list : DiscoveryService::FINGERPRINT_PORTS);
		}, 'ports');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function tls(string $host, int $port = 443): JSONResponse {
		return $this->guard(fn () => $this->tools->tls($host, $port), 'tls');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function http(string $url, int $maxRedirects = 5): JSONResponse {
		return $this->guard(function () use ($url, $maxRedirects) {
			$result = $this->tools->http($url, $maxRedirects);
			$result['findings'] = $this->tools->httpFindings($result);
			return $result;
		}, 'tls');
	}

	#[NoAdminRequired]
	public function subnet(string $cidr): JSONResponse {
		return $this->guard(fn () => $this->tools->subnet($cidr), 'subnet');
	}

	#[NoAdminRequired]
	public function wol(string $mac, string $broadcast = '255.255.255.255', int $port = 9): JSONResponse {
		return $this->guard(fn () => $this->tools->wakeOnLan($mac, $broadcast, $port), 'wol');
	}

	#[NoAdminRequired]
	public function serverInfo(): JSONResponse {
		return $this->guard(fn () => $this->tools->serverInfo(), 'server');
	}

	#[NoAdminRequired]
	public function macLookup(string $mac): JSONResponse {
		return $this->guard(fn () => $this->oui->describe($mac), 'subnet');
	}

	// ---------------------------------------------------------------- benchmarks

	#[NoAdminRequired]
	public function counters(): JSONResponse {
		return $this->guard(fn () => $this->bench->interfaceCounters(), 'bench');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 10, period: 300)]
	public function speedTest(int $megabytes = 25, bool $upload = true): JSONResponse {
		return $this->guard(fn () => $this->bench->speedTest($megabytes, $upload), 'bench');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	public function dnsBenchmark(array $resolvers = [], int $rounds = 2): JSONResponse {
		return $this->guard(fn () => $this->bench->dnsBenchmark($resolvers, $rounds), 'bench');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function httpTiming(string $url): JSONResponse {
		return $this->guard(fn () => $this->bench->httpTiming($url), 'bench');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 20, period: 300)]
	public function iperf(string $host, int $port = 5201, int $seconds = 10, bool $reverse = false, int $streams = 1): JSONResponse {
		return $this->guard(fn () => $this->bench->iperf($host, $port, $seconds, $reverse, $streams), 'bench');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 20, period: 60)]
	public function pathQuality(string $host, int $count = 10): JSONResponse {
		return $this->guard(fn () => $this->tools->pathQuality($host, $count), 'ping');
	}

	// ---------------------------------------------------------------- requirements

	#[NoAdminRequired]
	public function requirements(): JSONResponse {
		return new JSONResponse($this->requirements->report($this->permissions->isAdmin()));
	}

	// ---------------------------------------------------------------- nmap

	#[NoAdminRequired]
	#[UserRateLimit(limit: 20, period: 60)]
	public function nmapScan(array $targets = [], string $preset = 'quick', array $extra = []): JSONResponse {
		return $this->guard(fn () => $this->nmap->scan($targets, $preset, $extra), 'nmap');
	}

	// ---------------------------------------------------------------- saved connections

	#[NoAdminRequired]
	public function connections(): JSONResponse {
		return $this->guardAny(fn () => [
			'connections' => $this->endpoints->list($this->uid()),
			'kinds' => EndpointService::KINDS,
			'capabilities' => $this->transfer->capabilities(),
		], ['files', 'mail']);
	}

	#[NoAdminRequired]
	public function saveConnection(array $connection = []): JSONResponse {
		return $this->guardAny(fn () => ['connection' => $this->endpoints->save($this->uid(), $connection)], ['files', 'mail']);
	}

	#[NoAdminRequired]
	public function updateConnection(int $id, array $connection = []): JSONResponse {
		return $this->guardAny(fn () => ['connection' => $this->endpoints->save($this->uid(), $connection, $id)], ['files', 'mail']);
	}

	#[NoAdminRequired]
	public function deleteConnection(int $id): JSONResponse {
		return $this->guardAny(function () use ($id) {
			$this->endpoints->delete($id, $this->uid());
			return ['ok' => true];
		}, ['files', 'mail']);
	}

	/** One button that means the right thing for whichever kind of server it is. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function testConnection(int $id): JSONResponse {
		return $this->guardAny(function () use ($id) {
			$endpoint = $this->endpoints->get($id, $this->uid());
			$kind = (string)$endpoint->getKind();
			if (in_array($kind, ['ftp', 'sftp'], true)) {
				$this->permissions->require('files');
				return $this->transfer->test($endpoint);
			}
			if (in_array($kind, ['smtp', 'imap', 'pop3'], true)) {
				$this->permissions->require('mail');
				return $this->mail->login($endpoint);
			}
			$this->permissions->require('ssh');
			return $this->probe->ssh((string)$endpoint->getHost(), (int)$endpoint->getPort() ?: 22);
		}, ['files', 'mail']);
	}

	// ---------------------------------------------------------------- file transfer

	/**
	 * A saved connection when an id is given, or a one-off one built from the
	 * details in the request — so a server can be opened without saving
	 * anything first.
	 *
	 * @param array<string, mixed> $connection
	 */
	private function endpointFor(int $id, array $connection): \OCA\NetBase\Db\EndpointEntity {
		return $id > 0
			? $this->endpoints->get($id, $this->uid())
			: $this->endpoints->transient($this->uid(), $connection);
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 120, period: 60)]
	public function filesList(int $id = 0, string $path = '', array $connection = []): JSONResponse {
		return $this->guard(fn () => $this->transfer->listDirectory($this->endpointFor($id, $connection), $path), 'files');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function filesDownload(string $path, int $id = 0, string $target = 'NetBase', array $connection = []): JSONResponse {
		return $this->guard(fn () => $this->transfer->download($this->endpointFor($id, $connection), $this->uid(), $path, $target), 'files');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function filesUpload(string $source, int $id = 0, string $remoteDir = '', array $connection = []): JSONResponse {
		return $this->guard(fn () => $this->transfer->upload($this->endpointFor($id, $connection), $this->uid(), $source, $remoteDir), 'files');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function filesManage(string $action, string $path, int $id = 0, string $extra = '', array $connection = []): JSONResponse {
		return $this->guard(fn () => $this->transfer->manage($this->endpointFor($id, $connection), $action, $path, $extra), 'files');
	}


	// ---------------------------------------------------------------- mail

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	public function mailAudit(string $domain, array $selectors = [], bool $blocklists = true): JSONResponse {
		return $this->guard(fn () => $this->mail->audit($domain, $selectors, $blocklists), 'mail');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function mailProbe(string $host, int $port = 0, string $protocol = 'smtp', string $mode = 'auto'): JSONResponse {
		return $this->guard(fn () => $this->mail->probe($host, $port, $protocol, $mode), 'mail');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 20, period: 300)]
	public function mailRelayTest(string $host, int $port = 25, string $mode = 'starttls'): JSONResponse {
		return $this->guard(fn () => $this->mail->relayTest($host, $port, $mode), 'mail');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 10, period: 300)]
	public function mailSend(int $id, string $to, string $subject = '', string $body = ''): JSONResponse {
		return $this->guard(fn () => $this->mail->send($this->endpoints->get($id, $this->uid()), $to, $subject, $body), 'mail');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	public function mailBlocklist(string $ip): JSONResponse {
		return $this->guard(fn () => ['ip' => $ip, 'results' => $this->mail->blocklists($ip)], 'mail');
	}

	// ---------------------------------------------------------------- page preview

	/**
	 * A device's own web page, rendered on this server and returned as an
	 * image. It is a picture, not a frame: nothing from the page runs in the
	 * browser, and a page only this server can reach still shows up.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function preview(string $url, int $width = 1280, int $height = 900, int $wait = 4000, bool $full = false) {
		try {
			$this->permissions->require('preview');
			$result = $this->browser->screenshot($url, $width, $height, $wait, $full);
		} catch (\InvalidArgumentException $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		} catch (\RuntimeException $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_FORBIDDEN);
		} catch (\Throwable $e) {
			$this->logger->error('NetBase: ' . $e->getMessage(), ['exception' => $e, 'app' => 'netbase']);
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_INTERNAL_SERVER_ERROR);
		}
		if (!$result['ok']) {
			return new JSONResponse(['error' => $result['error']], Http::STATUS_BAD_GATEWAY);
		}
		$response = new DataDisplayResponse($result['image'], Http::STATUS_OK, ['Content-Type' => 'image/png']);
		// A snapshot of a live device is worth nothing once it is stale.
		$response->cacheFor(0);
		return $response;
	}

	// ---------------------------------------------------------------- SSH commands

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function sshRun(int $id, string $command): JSONResponse {
		return $this->guard(fn () => $this->ssh->run($this->endpoints->get($id, $this->uid()), $command), 'sshexec');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function sshPreset(int $id, string $preset): JSONResponse {
		return $this->guard(fn () => $this->ssh->preset($this->endpoints->get($id, $this->uid()), $preset), 'sshexec');
	}

	// ---------------------------------------------------------------- DNS in depth

	#[NoAdminRequired]
	#[UserRateLimit(limit: 120, period: 60)]
	public function dnsQuery(string $host, string $type = 'A', string $server = '', bool $dnssec = false): JSONResponse {
		return $this->guard(fn () => $this->dnsService->query($host, $type, $server, $dnssec), 'dns');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	public function dnsCompare(string $host, string $type = 'A', array $resolvers = []): JSONResponse {
		return $this->guard(fn () => $this->dnsService->compare($host, $type, $resolvers), 'dns');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	public function dnsTrace(string $host, string $type = 'A'): JSONResponse {
		return $this->guard(fn () => $this->dnsService->trace($host, $type), 'dns');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 20, period: 300)]
	public function dnsZoneTransfer(string $zone, string $nameserver = ''): JSONResponse {
		return $this->guard(fn () => $this->dnsService->zoneTransfer($zone, $nameserver), 'dns');
	}

	// ---------------------------------------------------------------- deeper tool checks

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	public function tlsVersions(string $host, int $port = 443): JSONResponse {
		return $this->guard(fn () => $this->tools->tlsVersions($host, $port), 'tls');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function tcpPing(string $host, int $port = 443, int $count = 5): JSONResponse {
		return $this->guard(fn () => $this->tools->tcpPing($host, $port, $count), 'ping');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 20, period: 300)]
	public function mtuDiscover(string $host): JSONResponse {
		return $this->guard(fn () => $this->tools->mtuDiscover($host), 'ping');
	}

	#[NoAdminRequired]
	public function subnetSplit(string $cidr, int $prefix): JSONResponse {
		return $this->guard(fn () => $this->tools->subnetSplit($cidr, $prefix), 'subnet');
	}

	#[NoAdminRequired]
	public function subnetAggregate(string $input): JSONResponse {
		return $this->guard(fn () => $this->tools->subnetAggregate($input), 'subnet');
	}

	// ---------------------------------------------------------------- service probes

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function probeSsh(string $host, int $port = 22, bool $authMethods = false): JSONResponse {
		return $this->guard(fn () => $this->probe->ssh($host, $port, true, $authMethods), 'ssh');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function probeTelnet(string $host, int $port = 23): JSONResponse {
		return $this->guard(fn () => $this->probe->telnet($host, $port), 'ssh');
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	public function probeNtp(string $host = 'pool.ntp.org'): JSONResponse {
		return $this->guard(fn () => $this->probe->ntp($host), 'ssh');
	}

	// ---------------------------------------------------------------- languages

	/**
	 * The languages NetBase ships, taken from the files themselves so a new
	 * translation appears in the picker as soon as it is dropped in.
	 *
	 * @return list<array{code: string, name: string}>
	 */
	private function availableLanguages(): array {
		$names = [
			'ja' => '日本語', 'en' => 'English', 'zh' => '简体中文', 'es' => 'Español',
			'fr' => 'Français', 'de' => 'Deutsch', 'ru' => 'Русский', 'pt' => 'Português',
			'ar' => 'العربية', 'hi' => 'हिन्दी', 'ko' => '한국어', 'it' => 'Italiano',
			'tr' => 'Türkçe', 'id' => 'Bahasa Indonesia', 'vi' => 'Tiếng Việt', 'th' => 'ไทย',
			'fa' => 'فارسی', 'pl' => 'Polski', 'uk' => 'Українська', 'cs' => 'Čeština',
		];
		$out = [];
		foreach (glob(__DIR__ . '/../../l10n/*.json') ?: [] as $path) {
			$code = basename($path, '.json');
			$out[] = ['code' => $code, 'name' => $names[$code] ?? $code];
		}
		usort($out, static fn (array $a, array $b) => strcmp($a['code'], $b['code']));
		return $out;
	}

	/** @return list<string> */
	private function languageCodes(): array {
		return array_map(static fn (array $l): string => $l['code'], $this->availableLanguages());
	}

	/** The dictionary for one language, for switching without reloading the page. */
	#[NoAdminRequired]
	public function getI18n(string $lang): JSONResponse {
		if (!in_array($lang, $this->languageCodes(), true)) {
			return new JSONResponse(['error' => 'Unknown language'], Http::STATUS_NOT_FOUND);
		}
		$path = realpath(__DIR__ . '/../../l10n/' . $lang . '.json');
		$base = realpath(__DIR__ . '/../../l10n');
		if ($path === false || $base === false || !str_starts_with($path, $base)) {
			return new JSONResponse(['error' => 'Unknown language'], Http::STATUS_NOT_FOUND);
		}
		$data = json_decode((string)file_get_contents($path), true);
		return new JSONResponse(['translations' => $data['translations'] ?? []]);
	}

	// ---------------------------------------------------------------- settings

	#[NoAdminRequired]
	public function getSettings(): JSONResponse {
		$uid = $this->permissions->uid();
		return new JSONResponse([
			'language' => $uid ? $this->config->getUserValue($uid, 'netbase', 'language', 'auto') : 'auto',
			'languages' => $this->availableLanguages(),
			'theme' => $uid ? $this->config->getUserValue($uid, 'netbase', 'theme', 'auto') : 'auto',
			'lastTargets' => $uid ? $this->config->getUserValue($uid, 'netbase', 'last_targets', '') : '',
			'tools' => PermissionService::TOOLS,
			'admin' => [
				'levels' => $this->permissions->levels(),
				'groups' => $this->permissions->groups(),
				'hideEmptyMenu' => $this->permissions->hidesEmptyMenu(),
				'maxHosts' => (int)$this->config->getAppValue('netbase', 'max_hosts', '65536'),
			],
		]);
	}

	#[NoAdminRequired]
	public function setSettings(array $settings = []): JSONResponse {
		$uid = $this->permissions->uid();
		if ($uid === null) {
			return new JSONResponse(['error' => 'Not signed in'], Http::STATUS_UNAUTHORIZED);
		}
		foreach (['language' => 'language', 'theme' => 'theme', 'lastTargets' => 'last_targets'] as $key => $stored) {
			if (!isset($settings[$key])) {
				continue;
			}
			$value = mb_substr((string)$settings[$key], 0, 512);
			if ($key === 'language' && $value !== 'auto' && !in_array($value, $this->languageCodes(), true)) {
				continue;
			}
			$this->config->setUserValue($uid, 'netbase', $stored, $value);
		}
		if ($this->permissions->isAdmin() && isset($settings['admin']) && is_array($settings['admin'])) {
			$admin = $settings['admin'];
			if (isset($admin['levels']) && is_array($admin['levels'])) {
				$this->permissions->setLevels(array_map('strval', $admin['levels']));
			}
			if (isset($admin['groups'])) {
				$this->permissions->setGroups((string)$admin['groups']);
			}
			if (isset($admin['hideEmptyMenu'])) {
				$this->permissions->setHidesEmptyMenu((bool)$admin['hideEmptyMenu']);
			}
			if (isset($admin['maxHosts'])) {
				$this->config->setAppValue('netbase', 'max_hosts', (string)max(256, min(1048576, (int)$admin['maxHosts'])));
			}
		}
		return $this->getSettings();
	}
}
