<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use Psr\Log\LoggerInterface;

/**
 * Domain-availability search, ported from KTEC's RDAP/WHOIS tool
 * (https://popup.jp/whois/). Given a label (the part before the dot) it checks
 * every ending in a tier and marks each:
 *   ○ free (RDAP 404 / WHOIS "no match")
 *   × taken (RDAP 200 domain / WHOIS registration / DNS NS delegation)
 *   △ registry unreachable but no DNS delegation (likely free)
 *   ? indeterminate
 *
 * Order per name: DNS NS delegation (cheap, cuts registry calls) → RDAP
 * (IANA bootstrap + overrides, per-registry rate-limit groups) → WHOIS:43
 * (JPRS for .jp, per-TLD server otherwise) → DNS-based △/? completion.
 */
class WhoisAvailabilityService {
	private const USER_AGENT = 'KTEC-NetBase-RDAP/1.0 (+https://github.com/ktec-nc-apps/NetBase)';
	private const BOOTSTRAP_TTL = 86400;
	private const CACHE_TTL = 604800;
	private const RDAP_TIMEOUT = 10;
	private const RDAP_CONNECT = 5;
	private const AVAIL_CONCURRENCY = 32;
	private const AVAIL_PER_HOST = 12;

	/** IANA bootstrap has no entry for these but they do serve RDAP. */
	private const RDAP_OVERRIDE = [
		'me' => ['https://rdap.identitydigital.services/rdap/'], 'io' => ['https://rdap.identitydigital.services/rdap/'],
		'bz' => ['https://rdap.identitydigital.services/rdap/'], 'ac' => ['https://rdap.identitydigital.services/rdap/'],
		'ag' => ['https://rdap.identitydigital.services/rdap/'], 'gi' => ['https://rdap.identitydigital.services/rdap/'],
		'mn' => ['https://rdap.identitydigital.services/rdap/'], 'pr' => ['https://rdap.identitydigital.services/rdap/'],
		'sc' => ['https://rdap.identitydigital.services/rdap/'], 'sh' => ['https://rdap.identitydigital.services/rdap/'],
		'vc' => ['https://rdap.identitydigital.services/rdap/'],
		'ch' => ['https://rdap.nic.ch/'], 'li' => ['https://rdap.nic.li/'],
		'de' => ['https://rdap.denic.de/'], 'ws' => ['https://rdap.website.ws/'],
	];
	/** Registries that ban on bursts: group => gap seconds / concurrency. */
	// Identity Digital serves 100+ gTLDs from one RDAP host. It rate-limits this
	// server's IP outright — every request comes back HTTP 429 no matter how slowly
	// we ask — so pacing cannot win. Instead the group is dropped the moment it
	// answers 429 (same as a 403 refusal): the rest of its endings are marked
	// "could not check" at once, fast and honest, rather than each waiting out a
	// doomed retry. A small gap/low concurrency keeps the few probes before that
	// polite.
	private const GROUP_GAP = ['gmo' => 2.5, 'godaddy' => 0.1, 'idd' => 0.1];
	private const GROUP_CONC = ['gmo' => 1, 'godaddy' => 4, 'idd' => 2];
	/** How long a group's 429/403 refusal is remembered across windows (seconds). */
	private const GROUP_BLOCK_TTL = 300;

	private string $cacheDir;
	private float $start = 0.0;
	private float $budget = 40.0;
	private ?array $defs = null;
	private array $mem = [];

	public function __construct(
		private ExecService $exec,
		private LoggerInterface $logger,
	) {
		$this->cacheDir = sys_get_temp_dir() . '/netbase-rdap';
	}

	/** The tiers on offer: name => number of endings. */
	public function tiers(): array {
		$d = $this->load();
		$out = [];
		foreach (($d['tiers'] ?? []) as $name => $list) {
			$out[$name] = count($list);
		}
		return $out;
	}

	/**
	 * Check a label across a tier.
	 *
	 * @return array{label: string, tier: string, results: list<array{tld: string, fqdn: string, mark: string, via: string, note: string}>}
	 */
	public function check(string $label, string $tier = 'core', int $offset = 0, int $limit = 0): array {
		$label = trim($label);
		$label = preg_replace('/^\.+|\.+$/', '', $label) ?? $label;
		if ($label === '' || !preg_match('/^(?!-)[a-z0-9-]{1,63}(?<!-)$/i', $this->toAscii($label))) {
			throw new \InvalidArgumentException('A single domain label is required (the part before the dot).');
		}
		@set_time_limit(70);
		$this->start = microtime(true);
		$this->budget = $tier === 'all' ? 55.0 : ($tier === 'core' ? 30.0 : 45.0);

		$d = $this->load();
		$list = $d['tiers'][$tier] ?? $d['tiers']['core'] ?? [];
		// One window of the tier at a time, so the browser can show progress and
		// draw results as they come instead of waiting for the whole tier.
		$total = count($list);
		$offset = max(0, $offset);
		if ($limit > 0) {
			$list = array_slice($list, $offset, $limit);
			$this->budget = 60.0; // a single window is small; give it room
		}
		$ascii = strtolower($this->toAscii($label));

		$out = [];
		$rdapJobs = [];
		$whoisJobs = [];
		$dnsNone = [];
		$fqdns = array_map(static fn ($t) => $ascii . '.' . $t, $list);
		$hasNs = $this->nsMulti($fqdns);

		foreach ($list as $tld) {
			$fqdn = $ascii . '.' . $tld;
			$out[$tld] = ['tld' => $tld, 'fqdn' => $fqdn, 'mark' => '?', 'via' => '', 'note' => 'not checked'];
			if (isset($hasNs[$fqdn])) {
				$out[$tld] = ['tld' => $tld, 'fqdn' => $fqdn, 'mark' => '×', 'via' => 'DNS', 'note' => 'NS delegation'];
				continue;
			}
			$dnsNone[$tld] = true;
			[$m, $srv, $pat] = $this->method($tld);
			if ($m === 'rdap') {
				$bases = $this->rdapBases($fqdn);
				if (!$bases) { $out[$tld]['note'] = 'no RDAP server'; continue; }
				$rdapJobs[$tld] = rtrim($bases[0], '/') . '/domain/' . rawurlencode($fqdn);
			} elseif ($m === 'jprs') {
				if (in_array($tld, ['jp', 'co.jp', 'or.jp', 'ne.jp', 'gr.jp', 'ac.jp', 'ed.jp', 'ad.jp', 'lg.jp'], true)) {
					$whoisJobs[$tld] = ['whois.jprs.jp', $fqdn . '/e', 'No match!!'];
				} else {
					$out[$tld]['note'] = 'JPRS rate limit — DNS only';
				}
			} elseif ($m === 'whois') {
				$whoisJobs[$tld] = [$srv, $fqdn, $pat];
			} else {
				$out[$tld]['note'] = 'registry offers no RDAP/WHOIS';
			}
		}

		$this->rdapCheck($rdapJobs, $out);
		$this->whoisCheck($whoisJobs, $out);

		// Complete the undecided from DNS: NS present → ×, none → △ — EXCEPT when
		// the registry answered but throttled or refused us (HTTP 429 / 403). That
		// tells us nothing about whether the name is taken, so calling it "likely
		// free" (△) is misleadingly optimistic; it stays undetermined (?), marked
		// as "could not check" so the reason is honest. A genuinely unreachable
		// registry (timeout, no RDAP/WHOIS server) with no DNS delegation is still
		// the likely-free △ it was.
		foreach ($out as $tld => $a) {
			if ($a['mark'] !== '?') { continue; }
			if ($this->timeLeft() < 1.5) { break; }
			if (!isset($dnsNone[$tld])) {
				$out[$tld] = ['tld' => $tld, 'fqdn' => $a['fqdn'], 'mark' => '×', 'via' => 'DNS', 'note' => 'NS delegation (' . $a['note'] . ')'];
			} elseif (preg_match('/(429|403|rate limit|refus|limiting|too many|query limit|time budget)/i', (string)$a['note']) === 1) {
				$out[$tld]['note'] = 'could not check — ' . $a['note'];
			} else {
				$out[$tld]['mark'] = '△';
				$out[$tld]['note'] = 'registry unreachable (' . $a['note'] . '); no DNS delegation';
			}
		}

		return [
			'label' => $label,
			'tier' => $tier,
			'total' => $total,
			'offset' => $offset,
			// The authoritative next raw index, so the client pages by this rather
			// than by the number of rows returned (which can be fewer if a window
			// ever deduped) and cannot drift, skip or repeat endings.
			'next' => $limit > 0 ? $offset + count($list) : $total,
			'done' => $limit <= 0 || ($offset + count($list) >= $total),
			'results' => array_values($out),
		];
	}

	// ---------------------------------------------------------------- internals

	private function load(): array {
		if ($this->defs !== null) { return $this->defs; }
		$path = __DIR__ . '/../../data/avail_tlds.json';
		$j = is_readable($path) ? json_decode((string)file_get_contents($path), true) : null;
		if (!is_array($j) || empty($j['tiers']['core'])) {
			$j = ['tiers' => ['core' => ['com', 'net', 'org', 'jp', 'co.jp', 'io', 'me', 'co', 'info', 'biz', 'xyz', 'dev']], 'tld' => []];
		}
		return $this->defs = $j;
	}

	/** @return array{0: string, 1: string, 2: string} method, whois server, no-match pattern */
	private function method(string $tld): array {
		$d = $this->load();
		$m = $d['tld'][$tld] ?? null;
		if ($m === null) {
			if ($tld === 'jp' || str_ends_with($tld, '.jp')) { return ['jprs', 'whois.jprs.jp', 'No match!!']; }
			if ($tld === 'co') { return ['whois', 'whois.registry.co', 'DOMAIN NOT FOUND']; }
			return ['rdap', '', ''];
		}
		return [$m['m'], $m['s'] ?? ($m['m'] === 'jprs' ? 'whois.jprs.jp' : ''), $m['p'] ?? ($m['m'] === 'jprs' ? 'No match!!' : '')];
	}

	private function toAscii(string $domain): string {
		if (function_exists('idn_to_ascii')) {
			$a = idn_to_ascii($domain, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
			if (is_string($a) && $a !== '') { return $a; }
		}
		return $domain;
	}

	private function timeLeft(): float { return $this->budget - (microtime(true) - $this->start); }

	private function cachePath(string $type, string $key): string {
		return $this->cacheDir . '/' . $type . '_' . sha1($type . '|' . strtolower($key)) . '.json';
	}
	private function cacheGet(string $type, string $key, bool $stale = false): ?array {
		$p = $this->cachePath($type, $key);
		if (!is_readable($p)) { return null; }
		if ((time() - (int)filemtime($p)) > self::CACHE_TTL && !$stale) { return null; }
		$j = json_decode((string)file_get_contents($p), true);
		return is_array($j) ? $j : null;
	}
	private function cachePut(string $type, string $key, array $data): void {
		if (!is_dir($this->cacheDir)) { @mkdir($this->cacheDir, 0700, true); }
		@file_put_contents($this->cachePath($type, $key), json_encode($data, JSON_UNESCAPED_SLASHES));
	}

	/** IANA RDAP bootstrap for a kind (dns), fetched and cached 24h. */
	private function bootstrap(string $kind): ?array {
		if (isset($this->mem['bs_' . $kind])) { return $this->mem['bs_' . $kind]; }
		$p = $this->cacheDir . '/_bootstrap_' . $kind . '.json';
		$fresh = is_readable($p) && (time() - (int)filemtime($p)) < self::BOOTSTRAP_TTL;
		if (!$fresh && $this->timeLeft() > 15) {
			$ch = curl_init('https://data.iana.org/rdap/' . $kind . '.json');
			curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_USERAGENT => self::USER_AGENT]);
			$body = curl_exec($ch);
			$code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
			curl_close($ch);
			if ($body !== false && $code === 200 && is_array(json_decode((string)$body, true))) {
				if (!is_dir($this->cacheDir)) { @mkdir($this->cacheDir, 0700, true); }
				@file_put_contents($p, $body);
			} elseif (is_readable($p)) {
				@touch($p);
			}
		}
		if (!is_readable($p)) { return $this->mem['bs_' . $kind] = null; }
		$data = json_decode((string)file_get_contents($p), true);
		return $this->mem['bs_' . $kind] = (is_array($data) && isset($data['services']) ? $data : null);
	}

	/** RDAP base URLs for a domain's TLD (longest match), plus the override map. */
	private function rdapBases(string $domain): array {
		$labels = explode('.', strtolower($domain));
		$bases = [];
		$bs = $this->bootstrap('dns');
		if ($bs) {
			for ($i = 1; $i < count($labels) && $i <= 2; $i++) {
				$suffix = implode('.', array_slice($labels, -$i));
				foreach ($bs['services'] as $svc) {
					if (in_array($suffix, $svc[0], true)) { foreach ($svc[1] as $u) { $bases[] = $u; } }
				}
				if ($bases) { break; }
			}
		}
		$tld = end($labels);
		if (!$bases && isset(self::RDAP_OVERRIDE[$tld])) { $bases = self::RDAP_OVERRIDE[$tld]; }
		return array_values(array_unique($bases));
	}

	private function hostOf(string $url): string { return (string)preg_replace('~^https?://([^/]+).*~', '$1', $url); }

	/** Which rate-limit group a host belongs to (GoDaddy is found by CNAME). */
	private function groupOf(string $host): ?string {
		if (array_key_exists($host, $this->mem)) { return $this->mem[$host]; }
		if ($host === 'rdap.gmoregistry.net') { return $this->mem[$host] = 'gmo'; }
		if ($host === 'rdap.identitydigital.services') { return $this->mem[$host] = 'idd'; }
		$c = $this->cacheGet('hostgroup', $host, true);
		if ($c !== null) { return $this->mem[$host] = ($c['group'] ?: null); }
		$grp = null;
		$h = $host;
		for ($i = 0; $i < 4; $i++) {
			$rr = @dns_get_record($h, DNS_CNAME);
			if (!$rr || empty($rr[0]['target'])) { break; }
			$h = $rr[0]['target'];
			if (stripos($h, 'godaddy') !== false) { $grp = 'godaddy'; break; }
		}
		$this->cachePut('hostgroup', $host, ['group' => $grp]);
		return $this->mem[$host] = $grp;
	}

	private function judgeRdap(int $code, $body): array {
		if ($code === 404) { return ['○', 'HTTP 404']; }
		$j = is_string($body) ? json_decode($body, true) : null;
		if (is_array($j) && (int)($j['errorCode'] ?? 0) === 404) { return ['○', 'errorCode 404']; }
		if ($code === 200 && is_array($j) && (isset($j['ldhName']) || ($j['objectClassName'] ?? '') === 'domain')) { return ['×', 'HTTP 200']; }
		if ($code === 429) { return ['?', 'HTTP 429']; }
		if ($code === 0) { return ['?', 'timeout']; }
		return ['?', 'HTTP ' . $code];
	}

	/** Run the RDAP jobs with curl_multi, honouring per-registry groups. */
	private function rdapCheck(array $jobs, array &$out): void {
		if (!$jobs || $this->timeLeft() < 5) { return; }
		// Group-limited registries first, so their pacing does not starve others.
		uksort($jobs, function ($a, $b) use ($jobs) {
			return (int)($this->groupOf($this->hostOf($jobs[$b])) !== null) <=> (int)($this->groupOf($this->hostOf($jobs[$a])) !== null);
		});
		$groupNextOk = [];
		$groupBlocked = [];
		// A rate-limit group that refused us in a recent window (each window is a
		// fresh request) is skipped from the outset here too, so a big tier does
		// not re-hit an IP-banned registry (e.g. Identity Digital) once per window.
		// Short-lived: the block is forgotten after GROUP_BLOCK_TTL so a registry
		// that recovers is tried again.
		foreach (self::GROUP_CONC as $g => $_c) {
			$cb = $this->cacheGet('groupblock', $g, true);
			if ($cb !== null && (time() - (int)($cb['t'] ?? 0)) < self::GROUP_BLOCK_TTL) { $groupBlocked[$g] = true; }
		}
		for ($pass = 0; $pass < 2 && $jobs; $pass++) {
			if ($this->timeLeft() < 5) { break; }
			$mh = curl_multi_init();
			$active = [];
			$queue = $jobs;
			$next = [];
			$groupBusy = [];
			$hostActive = [];
			$timeout = (int)max(3, min(self::RDAP_TIMEOUT, (int)$this->timeLeft() - 2));
			$add = function () use (&$queue, &$active, &$hostActive, &$groupBusy, &$groupNextOk, &$groupBlocked, &$out, $mh, $timeout) {
				foreach ($queue as $tld => $url) {
					if (count($active) >= self::AVAIL_CONCURRENCY) { break; }
					$host = $this->hostOf($url);
					$grp = $this->groupOf($host);
					if (($hostActive[$host] ?? 0) >= self::AVAIL_PER_HOST) { continue; }
					if ($grp !== null) {
						if (!empty($groupBlocked[$grp])) { unset($queue[$tld]); $out[$tld]['mark'] = '?'; $out[$tld]['via'] = $host; $out[$tld]['note'] = 'registry refusing/limiting (skipped)'; continue; }
						if (($groupBusy[$grp] ?? 0) >= (self::GROUP_CONC[$grp] ?? 1) || microtime(true) < ($groupNextOk[$grp] ?? 0)) { continue; }
						$groupBusy[$grp] = ($groupBusy[$grp] ?? 0) + 1;
					}
					unset($queue[$tld]);
					$ch = curl_init($url);
					curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => self::RDAP_CONNECT,
						CURLOPT_USERAGENT => self::USER_AGENT, CURLOPT_HTTPHEADER => ['Accept: application/rdap+json, application/json;q=0.9']]);
					curl_multi_add_handle($mh, $ch);
					$active[(int)$ch] = [$tld, $ch, $url];
					$hostActive[$host] = ($hostActive[$host] ?? 0) + 1;
				}
			};
			$add();
			do {
				$st = curl_multi_exec($mh, $running);
				if ($running) { curl_multi_select($mh, 0.2); } elseif ($queue) { usleep(100000); }
				while ($info = curl_multi_info_read($mh)) {
					$ch = $info['handle'];
					[$tld, , $url] = $active[(int)$ch];
					unset($active[(int)$ch]);
					$host = $this->hostOf($url);
					$grp = $this->groupOf($host);
					$hostActive[$host]--;
					$code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
					$body = curl_multi_getcontent($ch);
					if ($grp !== null) { $groupBusy[$grp]--; $groupNextOk[$grp] = microtime(true) + (self::GROUP_GAP[$grp] ?? 1.0); if ($code === 403 || $code === 429) { $groupBlocked[$grp] = true; $this->cachePut('groupblock', $grp, ['t' => time()]); } }
					[$mark, $note] = $this->judgeRdap($code, $body);
					$out[$tld] = ['tld' => $tld, 'fqdn' => $out[$tld]['fqdn'], 'mark' => $mark, 'via' => $host, 'note' => $note];
					if ($mark === '?' && $code !== 403) { $next[$tld] = $url; }
					curl_multi_remove_handle($mh, $ch);
					curl_close($ch);
				}
				$add();
				if (!$running && $queue && $this->timeLeft() < 4) { foreach ($queue as $tld => $url) { $out[$tld]['note'] = 'time budget'; $out[$tld]['via'] = $this->hostOf($url); } $queue = []; }
			} while (($running || $queue || $active) && $st === CURLM_OK);
			curl_multi_close($mh);
			$jobs = $next;
			if ($jobs && $this->timeLeft() > 10) { usleep(4000000); }
		}
	}

	private function judgeWhois(?string $resp, string $pattern): array {
		if ($resp === null || trim($resp) === '') { return ['?', 'no WHOIS response']; }
		if (strlen($resp) < 400 && preg_match('/queries exceeded|query limit|rate limit|too many|quota|access denied|blocked|exceeded/i', $resp)) { return ['?', 'WHOIS query limit']; }
		if (stripos($resp, 'large amount of requests') !== false) { return ['?', 'JPRS rate limit']; }
		if ($pattern !== '' && stripos($resp, $pattern) !== false) { return ['○', 'WHOIS: ' . $pattern]; }
		if (preg_match('/\b(no match|not found|no entries found|no data found|no data was found|no matching record|does not exist|not registered|not been registered|no object found|is available|status:\s*(available|free)|nothing found|no such domain|no record found|(?<!not )available for registration|object does not exist|not found in database)\b/i', $resp, $m)) { return ['○', 'WHOIS: ' . $m[1]]; }
		// JPRS (.jp/.co.jp) answers with a "Domain Information" block whose fields
		// carry a letter prefix ("a. [Domain Name]", "p. [Name Server]"), so the
		// line-anchored check below never matches it and a plainly registered name
		// (google.co.jp) came back "undecided". A [Domain Name] or [State] block
		// means the name is on file — taken — including the "Suspended"/pending-
		// delete states (e.g. granz.co.jp), which are registered, not free.
		if (preg_match('/\[(Domain Name|State)\]/i', $resp)) { return ['×', 'WHOIS: registered']; }
		if (preg_match('/^\s*(domain name|domain|\[domain name\]|nserver|name server|registrar|registrant|created|creation date|registered on)\s*[:\]]/im', $resp)) { return ['×', 'WHOIS: registered']; }
		return ['?', 'WHOIS undecided'];
	}

	/** Run the WHOIS:43 jobs and judge them. */
	private function whoisCheck(array $jobs, array &$out): void {
		if (!$jobs || $this->timeLeft() < 3) { return; }
		$plain = [];
		foreach ($jobs as $tld => [$srv, $q]) { $plain[$tld] = [$srv, $q]; }
		$resp = $this->whoisMulti($plain, microtime(true) + max(2.0, $this->timeLeft() - 1.5), 24, ['whois.jprs.jp' => 1]);
		foreach ($jobs as $tld => [$srv, $q, $pat]) {
			[$mark, $note] = $this->judgeWhois($resp[$tld] ?? null, $pat);
			$out[$tld] = ['tld' => $tld, 'fqdn' => $out[$tld]['fqdn'], 'mark' => $mark, 'via' => $srv, 'note' => $note];
		}
	}

	/** Non-blocking parallel port-43 WHOIS. jobs: key => [server, query]. */
	private function whoisMulti(array $jobs, float $deadline, int $conc = 24, array $perServer = []): array {
		$out = [];
		$ipcache = [];
		$active = [];
		$srvActive = [];
		$queue = $jobs;
		$resolve = static function (string $h) use (&$ipcache) { if (!isset($ipcache[$h])) { $ip = gethostbyname($h); $ipcache[$h] = ($ip === $h) ? null : $ip; } return $ipcache[$h]; };
		$start = function () use (&$queue, &$active, &$srvActive, &$out, $conc, $perServer, $resolve, $deadline) {
			foreach ($queue as $k => [$srv, $q]) {
				if (count($active) >= $conc) { break; }
				$lim = $perServer[$srv] ?? 4;
				if (($srvActive[$srv] ?? 0) >= $lim) { continue; }
				unset($queue[$k]);
				$ip = $resolve($srv);
				if (!$ip) { $out[$k] = null; continue; }
				$fp = @stream_socket_client('tcp://' . $ip . ':43', $errno, $errstr, 0, STREAM_CLIENT_ASYNC_CONNECT | STREAM_CLIENT_CONNECT);
				if (!$fp) { $out[$k] = null; continue; }
				stream_set_blocking($fp, false);
				$active[(int)$fp] = ['k' => $k, 'fp' => $fp, 'srv' => $srv, 'q' => $q, 'sent' => false, 'buf' => '', 't0' => microtime(true), 'to' => min(8.0, max(2.0, $deadline - microtime(true)))];
				$srvActive[$srv] = ($srvActive[$srv] ?? 0) + 1;
			}
		};
		$finish = function (array $a, bool $ok) use (&$active, &$srvActive, &$out) {
			@fclose($a['fp']);
			unset($active[(int)$a['fp']]);
			$srvActive[$a['srv']]--;
			$out[$a['k']] = ($ok && $a['buf'] !== '') ? $a['buf'] : null;
		};
		$start();
		while ($active || $queue) {
			if (microtime(true) > $deadline) { foreach ($active as $a) { $finish($a, false); } foreach ($queue as $k => $_) { $out[$k] = null; } break; }
			if (!$active) { usleep(50000); $start(); continue; }
			$r = [];
			$w = [];
			$e = null;
			foreach ($active as $a) { if ($a['sent']) { $r[] = $a['fp']; } else { $w[] = $a['fp']; } }
			$rr = $r;
			$ww = $w;
			@stream_select($rr, $ww, $e, 0, 200000);
			$now = microtime(true);
			foreach ($ww as $fp) { if (@fwrite($fp, $active[(int)$fp]['q'] . "\r\n") !== false) { $active[(int)$fp]['sent'] = true; } }
			foreach ($rr as $fp) {
				$chunk = @fread($fp, 65536);
				if ($chunk === '' || $chunk === false) { if (feof($fp)) { $this->finishHelper($active, $srvActive, $out, $fp, true); } } else {
					$active[(int)$fp]['buf'] .= $chunk;
					if (strlen($active[(int)$fp]['buf']) > 200000) { $this->finishHelper($active, $srvActive, $out, $fp, true); }
				}
			}
			foreach ($active as $fp2 => $a) { if ($now - $a['t0'] > $a['to']) { $this->finishHelper($active, $srvActive, $out, $a['fp'], $a['buf'] !== ''); } }
			$start();
		}
		return $out;
	}

	private function finishHelper(array &$active, array &$srvActive, array &$out, $fp, bool $ok): void {
		$id = (int)$fp;
		if (!isset($active[$id])) { return; }
		$a = $active[$id];
		@fclose($a['fp']);
		unset($active[$id]);
		$srvActive[$a['srv']]--;
		$out[$a['k']] = ($ok && $a['buf'] !== '') ? $a['buf'] : null;
	}

	/**
	 * Which of these names have an NS delegation. Uses `dig` in parallel when it
	 * is installed (system resolver); otherwise a bounded sequential fallback so
	 * a slow resolver cannot hang the request.
	 *
	 * @param list<string> $names
	 * @return array<string, true>
	 */
	private function nsMulti(array $names): array {
		$names = array_values(array_unique(array_filter($names, static fn ($n) => (bool)preg_match('/^[a-z0-9.-]+$/i', $n))));
		if (!$names) { return []; }
		if ($this->exec->available('dig') && $this->exec->available('xargs') && function_exists('proc_open')) {
			$digPath = $this->exec->which('dig') ?: 'dig';
			$cmd = 'xargs -P 32 -I{} ' . escapeshellarg($digPath) . ' +noall +answer +time=1 +tries=1 NS {}';
			$proc = @proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
			if (is_resource($proc)) {
				fwrite($pipes[0], implode("\n", $names) . "\n");
				fclose($pipes[0]);
				fclose($pipes[2]);
				$outp = stream_get_contents($pipes[1]);
				fclose($pipes[1]);
				proc_close($proc);
				$has = [];
				foreach (preg_split('/\R/', (string)$outp) as $line) {
					if (preg_match('/^([a-z0-9.-]+)\.\s+\d+\s+IN\s+NS\s+/i', $line, $m)) { $has[strtolower($m[1])] = true; }
				}
				return $has;
			}
		}
		// No dig: skip the pre-filter (keeps registry calls higher but never hangs).
		return [];
	}
}
