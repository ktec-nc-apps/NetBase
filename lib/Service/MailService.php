<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\EndpointEntity;
use Psr\Log\LoggerInterface;

/**
 * Mail server testing: the DNS side of a domain (MX, SPF, DKIM, DMARC, MTA-STS,
 * DANE, blocklists) and the servers themselves (SMTP, IMAP, POP3 — greeting,
 * capabilities, STARTTLS, certificate, authentication and a real test message).
 *
 * Everything here speaks the protocols over plain stream sockets, so no PHP
 * extension beyond the defaults is required — ext-imap is neither needed nor
 * used, which matters because it is gone from modern PHP builds.
 */
class MailService {
	/** Selectors worth trying when the user does not know theirs. */
	public const COMMON_SELECTORS = [
		'default', 'google', 'selector1', 'selector2', 'k1', 'k2', 'mail', 'dkim',
		's1', 's2', 'smtp', 'mandrill', 'sendgrid', 'zoho', 'protonmail', 'fm1', 'mxvault',
	];

	/** Public blocklists that answer over plain DNS. */
	public const BLOCKLISTS = [
		'zen.spamhaus.org' => 'Spamhaus ZEN',
		'bl.spamcop.net' => 'SpamCop',
		'b.barracudacentral.org' => 'Barracuda',
		'dnsbl.sorbs.net' => 'SORBS',
		'psbl.surriel.com' => 'PSBL',
		'all.s5h.net' => 's5h',
		'dnsbl-1.uceprotect.net' => 'UCEPROTECT level 1',
	];

	private const CRLF = "\r\n";

	public function __construct(
		private ToolService $tools,
		private EndpointService $endpoints,
		private L10nService $l,
		private LoggerInterface $logger,
	) {
	}

	// ------------------------------------------------------------------ domain

	/**
	 * Everything DNS knows about a domain's mail setup, plus a plain-language
	 * finding list: what is fine, what is worth fixing, what is broken.
	 *
	 * @param list<string> $selectors extra DKIM selectors to try
	 * @return array<string, mixed>
	 */
	public function audit(string $domain, array $selectors = [], bool $checkBlocklists = true): array {
		$domain = $this->tools->validateHost($domain);
		$findings = [];

		$mx = $this->mxRecords($domain, $findings);
		$spf = $this->spf($domain, $findings);
		$dmarc = $this->dmarc($domain, $findings);
		$dkim = $this->dkim($domain, $selectors, $findings);
		$mtaSts = $this->mtaSts($domain, $findings);
		$tlsRpt = $this->txtStartingWith('_smtp._tls.' . $domain, 'v=TLSRPTv1');
		$bimi = $this->txtStartingWith('default._bimi.' . $domain, 'v=BIMI1');

		if ($tlsRpt === null) {
			$findings[] = $this->finding('info', 'TLS-RPT', $this->l->t('No TLS reporting policy (_smtp._tls). Optional, but it is how you learn that delivery to you failed over TLS.'));
		}

		$dane = [];
		$blocklists = [];
		foreach ($mx as $host) {
			$dane[$host['host']] = $this->tlsa($host['host'], 25);
			if ($checkBlocklists) {
				foreach ($host['addresses'] as $addr) {
					if (($addr['family'] ?? '') === 'IPv4') {
						$blocklists[$addr['ip']] = $this->blocklists($addr['ip']);
					}
				}
			}
		}
		foreach ($blocklists as $ip => $listed) {
			$hits = array_values(array_filter($listed, static fn (array $r) => ($r['listed'] ?? false) === true));
			if ($hits !== []) {
				$findings[] = $this->finding('bad', 'Blocklist', $this->l->t('%s is listed on %s. Mail from that address is likely to be rejected.', [$ip, implode(', ', array_column($hits, 'name'))]));
			}
		}

		$srv = [];
		foreach (['_autodiscover._tcp', '_imaps._tcp', '_submission._tcp', '_pop3s._tcp'] as $prefix) {
			$found = @dns_get_record($prefix . '.' . $domain, DNS_SRV);
			if (is_array($found) && $found !== []) {
				foreach ($found as $r) {
					$srv[] = ['name' => $prefix, 'target' => (string)($r['target'] ?? ''), 'port' => (int)($r['port'] ?? 0), 'priority' => (int)($r['pri'] ?? 0)];
				}
			}
		}

		usort($findings, static function (array $a, array $b) {
			$rank = ['bad' => 0, 'warn' => 1, 'info' => 2, 'ok' => 3];
			return ($rank[$a['level']] ?? 9) <=> ($rank[$b['level']] ?? 9);
		});

		return [
			'domain' => $domain,
			'mx' => $mx,
			'spf' => $spf,
			'dmarc' => $dmarc,
			'dkim' => $dkim,
			'mtaSts' => $mtaSts,
			'tlsRpt' => $tlsRpt,
			'bimi' => $bimi,
			'dane' => $dane,
			'blocklists' => $blocklists,
			'srv' => $srv,
			'findings' => $findings,
			'score' => $this->score($findings),
		];
	}

	/** @param array<int, array<string, mixed>> $findings */
	private function mxRecords(string $domain, array &$findings): array {
		$records = @dns_get_record($domain, DNS_MX);
		$mx = [];
		if (!is_array($records) || $records === []) {
			// A domain with no MX still receives mail at its A record, which is
			// almost never what the owner intended.
			$a = @dns_get_record($domain, DNS_A);
			if (is_array($a) && $a !== []) {
				$findings[] = $this->finding('warn', 'MX', $this->l->t('No MX record. Mail would be delivered to the A record instead, which is rarely intended.'));
			} else {
				$findings[] = $this->finding('bad', 'MX', $this->l->t('No MX and no A record: this domain cannot receive mail at all.'));
			}
			return [];
		}
		usort($records, static fn ($a, $b) => ($a['pri'] ?? 0) <=> ($b['pri'] ?? 0));
		foreach ($records as $record) {
			$host = rtrim((string)($record['target'] ?? ''), '.');
			if ($host === '') {
				continue;
			}
			$addresses = [];
			foreach ([[DNS_A, 'ip', 'IPv4'], [DNS_AAAA, 'ipv6', 'IPv6']] as [$type, $key, $family]) {
				$found = @dns_get_record($host, $type);
				foreach (is_array($found) ? $found : [] as $entry) {
					$ip = (string)($entry[$key] ?? '');
					if ($ip === '') {
						continue;
					}
					$ptr = @gethostbyaddr($ip);
					$ptr = ($ptr !== false && $ptr !== $ip) ? $ptr : null;
					// Forward-confirmed reverse DNS: the PTR must resolve back
					// to the same address, or receivers treat the sender as
					// unidentified.
					$confirmed = false;
					if ($ptr !== null) {
						$back = @dns_get_record($ptr, $type);
						foreach (is_array($back) ? $back : [] as $entry2) {
							if ((string)($entry2[$key] ?? '') === $ip) {
								$confirmed = true;
							}
						}
					}
					$addresses[] = ['ip' => $ip, 'family' => $family, 'ptr' => $ptr, 'fcrdns' => $confirmed];
				}
			}
			if ($addresses === []) {
				$findings[] = $this->finding('bad', 'MX', $this->l->t('%s has no address record: that MX is unreachable.', [$host]));
			}
			foreach ($addresses as $addr) {
				if ($addr['ptr'] === null) {
					$findings[] = $this->finding('warn', 'Reverse DNS', $this->l->t('%s (%s) has no PTR record. Many receivers refuse mail from unnamed addresses.', [$host, $addr['ip']]));
				} elseif (!$addr['fcrdns']) {
					$findings[] = $this->finding('warn', 'Reverse DNS', $this->l->t('%s (%s) resolves to %s, which does not point back. Forward-confirmed reverse DNS is expected.', [$host, $addr['ip'], $addr['ptr']]));
				}
			}
			$mx[] = ['priority' => (int)($record['pri'] ?? 0), 'host' => $host, 'ttl' => $record['ttl'] ?? null, 'addresses' => $addresses];
		}
		if (count($mx) === 1) {
			$findings[] = $this->finding('info', 'MX', $this->l->t('Only one MX host. A second one means mail waits somewhere else instead of bouncing while you fix the first.'));
		}
		return $mx;
	}

	/** @param array<int, array<string, mixed>> $findings */
	private function spf(string $domain, array &$findings): ?array {
		$records = [];
		foreach (@dns_get_record($domain, DNS_TXT) ?: [] as $record) {
			$value = $this->txtValue($record);
			if (stripos($value, 'v=spf1') === 0) {
				$records[] = $value;
			}
		}
		if ($records === []) {
			$findings[] = $this->finding('bad', 'SPF', $this->l->t('No SPF record. Receivers cannot tell which servers may send for this domain.'));
			return null;
		}
		if (count($records) > 1) {
			$findings[] = $this->finding('bad', 'SPF', $this->l->t('More than one SPF record. That is a permanent error — receivers ignore all of them.'));
		}
		$value = $records[0];
		$terms = preg_split('/\s+/', trim($value)) ?: [];
		$lookups = 0;
		$all = null;
		$includes = [];
		foreach ($terms as $term) {
			$bare = ltrim($term, '+-~?');
			if (preg_match('/^(include|a|mx|ptr|exists|redirect)([:=]|$)/i', $bare, $m)) {
				$lookups++;
				if (strcasecmp($m[1], 'include') === 0) {
					$includes[] = substr($bare, 8);
				}
				if (strcasecmp($m[1], 'ptr') === 0) {
					$findings[] = $this->finding('warn', 'SPF', $this->l->t('The record uses "ptr", which is deprecated and slow. Replace it with a/mx/ip4.'));
				}
			}
			if (preg_match('/^[+\-~?]?all$/i', $term)) {
				$all = $term;
			}
		}
		if ($all === null) {
			$findings[] = $this->finding('warn', 'SPF', $this->l->t('The record has no "all" term, so nothing is stated about servers you did not list.'));
		} elseif (str_starts_with($all, '+')) {
			$findings[] = $this->finding('bad', 'SPF', $this->l->t('"+all" allows the whole internet to send as this domain. Use "-all" or "~all".'));
		} elseif (stripos($all, '?all') === 0) {
			$findings[] = $this->finding('warn', 'SPF', $this->l->t('"?all" states no policy at all. "-all" or "~all" is what receivers act on.'));
		}
		// The published limit is ten DNS-lookup terms; nested includes count too,
		// so a record already near the line breaks the moment a provider grows.
		$nested = $lookups;
		foreach (array_slice($includes, 0, 12) as $include) {
			$nested += $this->countSpfLookups($include, 1);
		}
		if ($nested > 10) {
			$findings[] = $this->finding('bad', 'SPF', $this->l->t('About %d DNS lookups, over the limit of 10. Receivers return permerror and SPF stops working.', [$nested]));
		} elseif ($nested >= 8) {
			$findings[] = $this->finding('warn', 'SPF', $this->l->t('About %d DNS lookups of the 10 allowed. Little room left before it breaks.', [$nested]));
		} else {
			$findings[] = $this->finding('ok', 'SPF', $this->l->t('Published, %s, about %d of the 10 permitted DNS lookups.', [$all ?? 'no all term', $nested]));
		}
		return ['record' => $value, 'terms' => $terms, 'lookups' => $nested, 'all' => $all, 'includes' => $includes, 'duplicates' => count($records)];
	}

	private function countSpfLookups(string $domain, int $depth): int {
		if ($depth > 3 || $domain === '') {
			return 1;
		}
		$count = 1;
		foreach (@dns_get_record($domain, DNS_TXT) ?: [] as $record) {
			$value = $this->txtValue($record);
			if (stripos($value, 'v=spf1') !== 0) {
				continue;
			}
			foreach (preg_split('/\s+/', trim($value)) ?: [] as $term) {
				$bare = ltrim($term, '+-~?');
				if (preg_match('/^(include|a|mx|ptr|exists|redirect)([:=])(.+)$/i', $bare, $m)) {
					$count += strcasecmp($m[1], 'include') === 0 ? $this->countSpfLookups($m[3], $depth + 1) : 1;
				}
			}
		}
		return $count;
	}

	/** @param array<int, array<string, mixed>> $findings */
	private function dmarc(string $domain, array &$findings): ?array {
		$value = $this->txtStartingWith('_dmarc.' . $domain, 'v=DMARC1');
		if ($value === null) {
			$findings[] = $this->finding('bad', 'DMARC', $this->l->t('No DMARC record. Nothing tells receivers what to do when a message fails checks, and you get no reports.'));
			return null;
		}
		$tags = [];
		foreach (explode(';', $value) as $part) {
			$part = trim($part);
			if ($part === '' || !str_contains($part, '=')) {
				continue;
			}
			[$k, $v] = array_map('trim', explode('=', $part, 2));
			$tags[strtolower($k)] = $v;
		}
		$policy = strtolower($tags['p'] ?? 'none');
		if ($policy === 'none') {
			$findings[] = $this->finding('warn', 'DMARC', $this->l->t('Policy is p=none: failures are reported but nothing is rejected. Move to quarantine, then reject, once the reports look clean.'));
		} else {
			$findings[] = $this->finding('ok', 'DMARC', $this->l->t('Policy p=%s.', [$policy]));
		}
		if (!isset($tags['rua'])) {
			$findings[] = $this->finding('warn', 'DMARC', $this->l->t('No rua address, so you never receive the aggregate reports that make DMARC useful.'));
		}
		if (isset($tags['pct']) && (int)$tags['pct'] < 100) {
			$findings[] = $this->finding('info', 'DMARC', $this->l->t('pct=%s: the policy applies to only part of your mail.', [$tags['pct']]));
		}
		return ['record' => $value, 'tags' => $tags, 'policy' => $policy];
	}

	/**
	 * @param list<string> $extra
	 * @param array<int, array<string, mixed>> $findings
	 */
	private function dkim(string $domain, array $extra, array &$findings): array {
		$selectors = [];
		foreach (array_merge($extra, self::COMMON_SELECTORS) as $selector) {
			$selector = strtolower(trim($selector));
			if ($selector !== '' && preg_match('/^[a-z0-9._-]{1,63}$/', $selector)) {
				$selectors[$selector] = true;
			}
		}
		$found = [];
		foreach (array_keys($selectors) as $selector) {
			$value = $this->txtStartingWith($selector . '._domainkey.' . $domain, 'v=DKIM1', true);
			if ($value === null) {
				continue;
			}
			$tags = [];
			foreach (explode(';', $value) as $part) {
				$part = trim($part);
				if ($part === '' || !str_contains($part, '=')) {
					continue;
				}
				[$k, $v] = array_map('trim', explode('=', $part, 2));
				$tags[strtolower($k)] = $v;
			}
			$bits = null;
			$key = $tags['p'] ?? '';
			if ($key === '') {
				$findings[] = $this->finding('warn', 'DKIM', $this->l->t('Selector "%s" exists but its key is empty, which means revoked.', [$selector]));
			} else {
				$pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split($key, 64, "\n") . "-----END PUBLIC KEY-----\n";
				$public = @openssl_pkey_get_public($pem);
				if ($public !== false) {
					$details = @openssl_pkey_get_details($public);
					$bits = $details['bits'] ?? null;
					if (is_int($bits) && $bits < 1024) {
						$findings[] = $this->finding('bad', 'DKIM', $this->l->t('Selector "%s" uses a %d-bit key. 2048 bits is the current expectation.', [$selector, $bits]));
					} elseif (is_int($bits) && $bits < 2048) {
						$findings[] = $this->finding('warn', 'DKIM', $this->l->t('Selector "%s" uses a %d-bit key; 2048 bits is recommended.', [$selector, $bits]));
					}
				}
			}
			$found[] = ['selector' => $selector, 'record' => $value, 'tags' => $tags, 'bits' => $bits];
		}
		if ($found === []) {
			$findings[] = $this->finding('warn', 'DKIM', $this->l->t('No DKIM key found under the selectors tried. Enter your own selector if you use one — the name is in the DKIM-Signature header of a message you sent.'));
		} else {
			$findings[] = $this->finding('ok', 'DKIM', $this->l->t('%d selector(s) published: %s.', [count($found), implode(', ', array_column($found, 'selector'))]));
		}
		return $found;
	}

	/** @param array<int, array<string, mixed>> $findings */
	private function mtaSts(string $domain, array &$findings): ?array {
		$record = $this->txtStartingWith('_mta-sts.' . $domain, 'v=STSv1');
		if ($record === null) {
			$findings[] = $this->finding('info', 'MTA-STS', $this->l->t('No MTA-STS policy. Without it, delivery to you can be downgraded to plain text by an attacker in the path.'));
			return null;
		}
		$policy = null;
		if (function_exists('curl_init')) {
			$curl = curl_init('https://mta-sts.' . $domain . '/.well-known/mta-sts.txt');
			curl_setopt_array($curl, [
				CURLOPT_RETURNTRANSFER => true,
				CURLOPT_TIMEOUT => 8,
				CURLOPT_CONNECTTIMEOUT => 5,
				CURLOPT_FOLLOWLOCATION => false,
				CURLOPT_USERAGENT => 'NetBase/1.0 (+Nextcloud)',
			]);
			$body = curl_exec($curl);
			$status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
			curl_close($curl);
			if (is_string($body) && $status === 200) {
				$policy = mb_substr($body, 0, 4000);
				if (!preg_match('/mode:\s*(enforce|testing|none)/i', $policy, $m)) {
					$findings[] = $this->finding('warn', 'MTA-STS', $this->l->t('The policy file has no mode line.'));
				} elseif (strtolower($m[1]) !== 'enforce') {
					$findings[] = $this->finding('info', 'MTA-STS', $this->l->t('Policy mode is "%s"; only "enforce" actually prevents downgrades.', [strtolower($m[1])]));
				} else {
					$findings[] = $this->finding('ok', 'MTA-STS', $this->l->t('Policy published and set to enforce.'));
				}
			} else {
				$findings[] = $this->finding('bad', 'MTA-STS', $this->l->t('The DNS record exists but https://mta-sts.%s/.well-known/mta-sts.txt did not return a policy (HTTP %d).', [$domain, $status]));
			}
		}
		return ['record' => $record, 'policy' => $policy];
	}

	// ------------------------------------------------------------------ DNS bits

	private function txtValue(array $record): string {
		if (isset($record['txt'])) {
			return (string)$record['txt'];
		}
		return implode('', $record['entries'] ?? []);
	}

	private function txtStartingWith(string $name, string $prefix, bool $quiet = false): ?string {
		$records = @dns_get_record($name, DNS_TXT);
		foreach (is_array($records) ? $records : [] as $record) {
			$value = $this->txtValue($record);
			if (stripos($value, $prefix) === 0) {
				return $value;
			}
		}
		return null;
	}

	/**
	 * TLSA records for DANE. dns_get_record() cannot ask for type 52, so the
	 * query goes out as a raw DNS packet to the system resolver.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public function tlsa(string $host, int $port = 25): array {
		$name = '_' . $port . '._tcp.' . $host;
		$answers = $this->rawQuery($name, 52);
		$out = [];
		foreach ($answers as $rdata) {
			if (strlen($rdata) < 4) {
				continue;
			}
			$usage = ord($rdata[0]);
			$selector = ord($rdata[1]);
			$matching = ord($rdata[2]);
			$out[] = [
				'usage' => $usage,
				'selector' => $selector,
				'matching' => $matching,
				'data' => strtolower(bin2hex(substr($rdata, 3))),
			];
		}
		return $out;
	}

	/**
	 * One DNS question, straight to the first configured resolver.
	 *
	 * @return list<string> the raw RDATA of each matching answer
	 */
	private function rawQuery(string $name, int $type, float $timeout = 3.0): array {
		$resolver = $this->firstResolver();
		if ($resolver === null) {
			return [];
		}
		$id = random_int(0, 0xffff);
		$packet = pack('n6', $id, 0x0100, 1, 0, 0, 0);
		foreach (explode('.', rtrim($name, '.')) as $label) {
			$label = substr($label, 0, 63);
			$packet .= chr(strlen($label)) . $label;
		}
		$packet .= "\0" . pack('nn', $type, 1);

		$errno = 0;
		$errstr = '';
		$target = str_contains($resolver, ':') ? '[' . $resolver . ']' : $resolver;
		$socket = @stream_socket_client('udp://' . $target . ':53', $errno, $errstr, $timeout);
		if ($socket === false) {
			return [];
		}
		stream_set_timeout($socket, (int)$timeout);
		@fwrite($socket, $packet);
		$response = @fread($socket, 4096);
		@fclose($socket);
		if (!is_string($response) || strlen($response) < 12) {
			return [];
		}

		$header = unpack('nid/nflags/nqd/nan/nns/nar', substr($response, 0, 12));
		if (!is_array($header) || $header['id'] !== $id || $header['an'] < 1) {
			return [];
		}
		$offset = 12;
		for ($i = 0; $i < $header['qd']; $i++) {
			$offset = $this->skipName($response, $offset) + 4;
		}
		$out = [];
		for ($i = 0; $i < $header['an']; $i++) {
			$offset = $this->skipName($response, $offset);
			if ($offset + 10 > strlen($response)) {
				break;
			}
			$rr = unpack('ntype/nclass/Nttl/nlength', substr($response, $offset, 10));
			$offset += 10;
			$rdata = substr($response, $offset, (int)$rr['length']);
			$offset += (int)$rr['length'];
			if ((int)$rr['type'] === $type) {
				$out[] = $rdata;
			}
		}
		return $out;
	}

	private function skipName(string $packet, int $offset): int {
		while ($offset < strlen($packet)) {
			$length = ord($packet[$offset]);
			if ($length === 0) {
				return $offset + 1;
			}
			if (($length & 0xc0) === 0xc0) {
				return $offset + 2;
			}
			$offset += $length + 1;
		}
		return $offset;
	}

	private function firstResolver(): ?string {
		foreach (['/etc/resolv.conf'] as $path) {
			if (!is_readable($path)) {
				continue;
			}
			foreach (explode("\n", (string)file_get_contents($path)) as $line) {
				if (preg_match('/^\s*nameserver\s+(\S+)/', $line, $m) && filter_var($m[1], FILTER_VALIDATE_IP) !== false) {
					return $m[1];
				}
			}
		}
		return '1.1.1.1';
	}

	/**
	 * @return array<int, array<string, mixed>>
	 */
	public function blocklists(string $ip): array {
		if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
			return [];
		}
		$reversed = implode('.', array_reverse(explode('.', $ip)));
		$out = [];
		foreach (self::BLOCKLISTS as $zone => $name) {
			$answers = @dns_get_record($reversed . '.' . $zone, DNS_A);
			$codes = [];
			foreach (is_array($answers) ? $answers : [] as $answer) {
				$codes[] = (string)($answer['ip'] ?? '');
			}
			// 127.255.255.x means "your query was refused" (usually a public
			// resolver), not "listed" — reporting that as a hit would be a lie.
			$refused = $codes !== [] && preg_grep('/^127\.255\.255\./', $codes) !== [];
			$listed = $codes !== [] && !$refused;
			$reason = null;
			if ($listed) {
				$txt = @dns_get_record($reversed . '.' . $zone, DNS_TXT);
				if (is_array($txt) && $txt !== []) {
					$reason = $this->txtValue($txt[0]);
				}
			}
			$out[] = ['zone' => $zone, 'name' => $name, 'listed' => $listed, 'blocked' => $refused, 'codes' => $codes, 'reason' => $reason];
		}
		return $out;
	}

	// ------------------------------------------------------------------ servers

	/**
	 * Talk to a mail server and report what it offers: greeting, capabilities,
	 * STARTTLS, certificate and authentication mechanisms.
	 *
	 * @return array<string, mixed>
	 */
	public function probe(string $host, int $port, string $protocol, string $mode = 'auto', float $timeout = 8.0): array {
		$host = $this->tools->validateHost($host);
		$protocol = strtolower($protocol);
		if (!in_array($protocol, ['smtp', 'imap', 'pop3'], true)) {
			throw new \InvalidArgumentException('Unknown mail protocol');
		}
		$port = $port > 0 ? max(1, min(65535, $port)) : $this->defaultPort($protocol, $mode);
		if ($mode === 'auto') {
			$mode = in_array($port, [465, 993, 995], true) ? 'tls' : 'starttls';
		}

		$started = microtime(true);
		$transcript = [];
		$result = [
			'host' => $host, 'port' => $port, 'protocol' => $protocol, 'mode' => $mode,
			'ok' => false, 'greeting' => null, 'capabilities' => [], 'auth' => [],
			'starttls' => null, 'tls' => null, 'error' => null, 'transcript' => [],
		];

		try {
			$stream = $this->connect($host, $port, $mode === 'tls', $timeout, $tlsInfo);
			$result['tls'] = $tlsInfo;
			$greeting = $this->readReply($stream, $protocol, $transcript);
			$result['greeting'] = trim($greeting);

			if ($protocol === 'smtp') {
				$helo = $this->heloName();
				$reply = $this->command($stream, 'EHLO ' . $helo, $protocol, $transcript);
				$caps = $this->smtpCapabilities($reply);
				if ($caps === []) {
					$reply = $this->command($stream, 'HELO ' . $helo, $protocol, $transcript);
				}
				$result['starttls'] = isset($caps['STARTTLS']);
				if ($mode === 'starttls' && isset($caps['STARTTLS'])) {
					$this->command($stream, 'STARTTLS', $protocol, $transcript);
					$tlsInfo = $this->enableCrypto($stream, $host);
					$result['tls'] = $tlsInfo;
					$reply = $this->command($stream, 'EHLO ' . $helo, $protocol, $transcript);
					$caps = $this->smtpCapabilities($reply);
				}
				$result['capabilities'] = $caps;
				$result['auth'] = isset($caps['AUTH']) ? preg_split('/\s+/', trim((string)$caps['AUTH'])) : [];
				$this->command($stream, 'QUIT', $protocol, $transcript);
			} elseif ($protocol === 'imap') {
				$reply = $this->command($stream, 'a1 CAPABILITY', $protocol, $transcript);
				$caps = $this->imapCapabilities($reply);
				$result['starttls'] = in_array('STARTTLS', $caps, true);
				if ($mode === 'starttls' && $result['starttls']) {
					$this->command($stream, 'a2 STARTTLS', $protocol, $transcript);
					$result['tls'] = $this->enableCrypto($stream, $host);
					$reply = $this->command($stream, 'a3 CAPABILITY', $protocol, $transcript);
					$caps = $this->imapCapabilities($reply);
				}
				$result['capabilities'] = $caps;
				$result['auth'] = array_values(array_filter($caps, static fn ($c) => str_starts_with($c, 'AUTH=')));
				$this->command($stream, 'a9 LOGOUT', $protocol, $transcript);
			} else {
				$reply = $this->command($stream, 'CAPA', $protocol, $transcript, false, true);
				$caps = array_values(array_filter(array_map('trim', explode("\n", $reply)), static fn ($l) => $l !== '' && $l !== '.' && !str_starts_with($l, '+OK') && !str_starts_with($l, '-ERR')));
				$result['starttls'] = in_array('STLS', $caps, true);
				if ($mode === 'starttls' && $result['starttls']) {
					$this->command($stream, 'STLS', $protocol, $transcript);
					$result['tls'] = $this->enableCrypto($stream, $host);
					$reply = $this->command($stream, 'CAPA', $protocol, $transcript, false, true);
					$caps = array_values(array_filter(array_map('trim', explode("\n", $reply)), static fn ($l) => $l !== '' && $l !== '.' && !str_starts_with($l, '+OK')));
				}
				$result['capabilities'] = $caps;
				foreach ($caps as $cap) {
					if (str_starts_with($cap, 'SASL')) {
						$result['auth'] = preg_split('/\s+/', trim(substr($cap, 4)));
					}
				}
				$this->command($stream, 'QUIT', $protocol, $transcript);
			}
			@fclose($stream);
			$result['ok'] = true;
		} catch (\Throwable $e) {
			$result['error'] = $e->getMessage();
		}

		$result['transcript'] = $transcript;
		$result['seconds'] = round(microtime(true) - $started, 3);
		$result['findings'] = $this->serverFindings($result);
		return $result;
	}

	/** @return array<int, array<string, mixed>> */
	private function serverFindings(array $probe): array {
		$findings = [];
		if (!$probe['ok']) {
			return [$this->finding('bad', 'Connection', (string)($probe['error'] ?? 'Could not connect'))];
		}
		$tls = $probe['tls'] ?? null;
		if ($tls === null) {
			$findings[] = $this->finding('bad', 'Encryption', $this->l->t('The session stayed in plain text. Passwords and mail would cross the network readable.'));
		} else {
			if (!empty($tls['expiresIn']) && $tls['expiresIn'] < 14) {
				$findings[] = $this->finding('bad', 'Certificate', $this->l->t('The certificate expires in %d days.', [$tls['expiresIn']]));
			} elseif (!empty($tls['expiresIn']) && $tls['expiresIn'] < 30) {
				$findings[] = $this->finding('warn', 'Certificate', $this->l->t('The certificate expires in %d days.', [$tls['expiresIn']]));
			}
			if (isset($tls['nameMatches']) && $tls['nameMatches'] === false) {
				$findings[] = $this->finding('warn', 'Certificate', $this->l->t('The certificate does not cover the host name used to reach it.'));
			}
			if (isset($tls['protocol']) && preg_match('/TLSv1(\.[01])?$/', (string)$tls['protocol'])) {
				$findings[] = $this->finding('warn', 'Encryption', $this->l->t('Negotiated %s. TLS 1.2 is the minimum receivers expect today.', [$tls['protocol']]));
			} else {
				$findings[] = $this->finding('ok', 'Encryption', $this->l->t('%s with %s.', [$tls['protocol'] ?? 'TLS', $tls['cipher'] ?? 'a modern cipher']));
			}
		}
		if ($probe['protocol'] === 'smtp' && $probe['auth'] === [] && $tls !== null) {
			$findings[] = $this->finding('info', 'Authentication', $this->l->t('No AUTH mechanisms offered on this port. That is normal for port 25 between servers.'));
		}
		if (in_array('PLAIN', array_map('strtoupper', (array)$probe['auth']), true) && $tls === null) {
			$findings[] = $this->finding('bad', 'Authentication', $this->l->t('AUTH PLAIN is offered without encryption: the password would be sent in the clear.'));
		}
		return $findings;
	}

	/**
	 * Open-relay test: offer the server a message from an outside address to an
	 * outside address. Nothing is ever sent — the conversation stops before
	 * DATA — but a server that accepts the recipient would relay for anyone.
	 *
	 * @return array<string, mixed>
	 */
	public function relayTest(string $host, int $port = 25, string $mode = 'starttls', float $timeout = 8.0): array {
		$host = $this->tools->validateHost($host);
		$transcript = [];
		$probeFrom = 'relay-test@' . $this->heloName();
		$probeTo = 'relay-test@example.com';
		try {
			$stream = $this->connect($host, $port ?: 25, $mode === 'tls', $timeout, $tlsInfo);
			$this->readReply($stream, 'smtp', $transcript);
			$helo = $this->heloName();
			$reply = $this->command($stream, 'EHLO ' . $helo, 'smtp', $transcript);
			if ($mode === 'starttls' && isset($this->smtpCapabilities($reply)['STARTTLS'])) {
				$this->command($stream, 'STARTTLS', 'smtp', $transcript);
				$this->enableCrypto($stream, $host);
				$this->command($stream, 'EHLO ' . $helo, 'smtp', $transcript);
			}
			$this->command($stream, 'MAIL FROM:<' . $probeFrom . '>', 'smtp', $transcript);
			$reply = $this->command($stream, 'RCPT TO:<' . $probeTo . '>', 'smtp', $transcript);
			$this->command($stream, 'RSET', 'smtp', $transcript);
			$this->command($stream, 'QUIT', 'smtp', $transcript);
			@fclose($stream);
			$accepted = (int)substr(trim($reply), 0, 1) === 2;
			return [
				'host' => $host, 'port' => $port ?: 25, 'openRelay' => $accepted,
				'reply' => trim($reply), 'transcript' => $transcript,
				'findings' => [$accepted
					? $this->finding('bad', 'Open relay', $this->l->t('The server accepted a foreign sender and a foreign recipient. Anyone can send mail through it — fix this now.'))
					: $this->finding('ok', 'Open relay', $this->l->t('Relaying for a foreign recipient was refused, which is correct.'))],
			];
		} catch (\Throwable $e) {
			return ['host' => $host, 'port' => $port ?: 25, 'openRelay' => null, 'error' => $e->getMessage(), 'transcript' => $transcript, 'findings' => []];
		}
	}

	/**
	 * Sign in to a saved mailbox or submission server and report what is there.
	 *
	 * @return array<string, mixed>
	 */
	public function login(EndpointEntity $endpoint, float $timeout = 12.0): array {
		$kind = (string)$endpoint->getKind();
		if (!in_array($kind, ['smtp', 'imap', 'pop3'], true)) {
			throw new \InvalidArgumentException('Not a mail connection');
		}
		$host = (string)$endpoint->getHost();
		$port = (int)$endpoint->getPort() ?: $this->defaultPort($kind, 'tls');
		$mode = (string)$this->endpoints->option($endpoint, 'mode', 'tls');
		$user = (string)$endpoint->getUsername();
		$pass = $this->endpoints->secret($endpoint);
		$transcript = [];
		$out = ['kind' => $kind, 'host' => $host, 'port' => $port, 'ok' => false, 'error' => null, 'details' => [], 'transcript' => []];

		try {
			$stream = $this->connect($host, $port, $mode === 'tls', $timeout, $tlsInfo);
			$this->readReply($stream, $kind, $transcript);
			if ($kind === 'smtp') {
				$helo = $this->heloName();
				$reply = $this->command($stream, 'EHLO ' . $helo, 'smtp', $transcript);
				$caps = $this->smtpCapabilities($reply);
				if ($mode === 'starttls' && isset($caps['STARTTLS'])) {
					$this->command($stream, 'STARTTLS', 'smtp', $transcript);
					$tlsInfo = $this->enableCrypto($stream, $host);
					$reply = $this->command($stream, 'EHLO ' . $helo, 'smtp', $transcript);
					$caps = $this->smtpCapabilities($reply);
				}
				$this->smtpAuth($stream, $caps, $user, $pass, $transcript);
				$out['details'] = ['capabilities' => $caps];
				$this->command($stream, 'QUIT', 'smtp', $transcript);
			} elseif ($kind === 'imap') {
				if ($mode === 'starttls') {
					$reply = $this->command($stream, 'a1 CAPABILITY', 'imap', $transcript);
					if (in_array('STARTTLS', $this->imapCapabilities($reply), true)) {
						$this->command($stream, 'a2 STARTTLS', 'imap', $transcript);
						$tlsInfo = $this->enableCrypto($stream, $host);
					}
				}
				$reply = $this->command($stream, 'a3 LOGIN ' . $this->imapQuote($user) . ' ' . $this->imapQuote($pass), 'imap', $transcript, true);
				if (!preg_match('/^a3 OK/mi', $reply)) {
					throw new \RuntimeException('Sign-in refused: ' . trim(strtok($reply, "\n")));
				}
				$status = $this->command($stream, 'a4 STATUS INBOX (MESSAGES UNSEEN RECENT)', 'imap', $transcript);
				$list = $this->command($stream, 'a5 LIST "" "%"', 'imap', $transcript);
				$folders = [];
				foreach (explode("\n", $list) as $line) {
					if (preg_match('/^\* LIST \([^)]*\) "[^"]*" (.+)$/', trim($line), $m)) {
						$folders[] = trim($m[1], '"');
					}
				}
				$counts = [];
				if (preg_match('/MESSAGES (\d+)/i', $status, $m)) {
					$counts['messages'] = (int)$m[1];
				}
				if (preg_match('/UNSEEN (\d+)/i', $status, $m)) {
					$counts['unseen'] = (int)$m[1];
				}
				$out['details'] = ['inbox' => $counts, 'folders' => array_slice($folders, 0, 100)];
				$this->command($stream, 'a9 LOGOUT', 'imap', $transcript);
			} else {
				if ($mode === 'starttls') {
					$reply = $this->command($stream, 'CAPA', 'pop3', $transcript, false, true);
					if (str_contains($reply, 'STLS')) {
						$this->command($stream, 'STLS', 'pop3', $transcript);
						$tlsInfo = $this->enableCrypto($stream, $host);
					}
				}
				$reply = $this->command($stream, 'USER ' . $user, 'pop3', $transcript);
				$reply = $this->command($stream, 'PASS ' . $pass, 'pop3', $transcript, true);
				if (!str_starts_with(trim($reply), '+OK')) {
					throw new \RuntimeException('Sign-in refused: ' . trim($reply));
				}
				$stat = $this->command($stream, 'STAT', 'pop3', $transcript);
				$counts = [];
				if (preg_match('/\+OK\s+(\d+)\s+(\d+)/', $stat, $m)) {
					$counts = ['messages' => (int)$m[1], 'bytes' => (int)$m[2]];
				}
				$out['details'] = ['mailbox' => $counts];
				$this->command($stream, 'QUIT', 'pop3', $transcript);
			}
			@fclose($stream);
			$out['ok'] = true;
			$out['tls'] = $tlsInfo;
		} catch (\Throwable $e) {
			$out['error'] = $e->getMessage();
		}
		$out['transcript'] = $this->redact($transcript);
		$this->endpoints->touch($endpoint, $out['ok'] ? 'Signed in' : ('Failed: ' . (string)$out['error']));
		return $out;
	}

	/**
	 * Send a real test message through a saved SMTP connection.
	 *
	 * @return array<string, mixed>
	 */
	public function send(EndpointEntity $endpoint, string $to, string $subject, string $body, float $timeout = 20.0): array {
		if ((string)$endpoint->getKind() !== 'smtp') {
			throw new \InvalidArgumentException('Not an SMTP connection');
		}
		if (filter_var($to, FILTER_VALIDATE_EMAIL) === false) {
			throw new \InvalidArgumentException('The recipient is not a valid address');
		}
		$from = (string)$this->endpoints->option($endpoint, 'from', '');
		if ($from === '' || filter_var($from, FILTER_VALIDATE_EMAIL) === false) {
			$from = (string)$endpoint->getUsername();
		}
		if (filter_var($from, FILTER_VALIDATE_EMAIL) === false) {
			throw new \InvalidArgumentException('This connection has no valid sender address. Set one in the connection settings.');
		}

		$host = (string)$endpoint->getHost();
		$port = (int)$endpoint->getPort() ?: 587;
		$mode = (string)$this->endpoints->option($endpoint, 'mode', 'starttls');
		$transcript = [];
		try {
			$stream = $this->connect($host, $port, $mode === 'tls', $timeout, $tlsInfo);
			$this->readReply($stream, 'smtp', $transcript);
			$helo = $this->heloName();
			$reply = $this->command($stream, 'EHLO ' . $helo, 'smtp', $transcript);
			$caps = $this->smtpCapabilities($reply);
			if ($mode === 'starttls' && isset($caps['STARTTLS'])) {
				$this->command($stream, 'STARTTLS', 'smtp', $transcript);
				$tlsInfo = $this->enableCrypto($stream, $host);
				$reply = $this->command($stream, 'EHLO ' . $helo, 'smtp', $transcript);
				$caps = $this->smtpCapabilities($reply);
			}
			if ((string)$endpoint->getUsername() !== '') {
				$this->smtpAuth($stream, $caps, (string)$endpoint->getUsername(), $this->endpoints->secret($endpoint), $transcript);
			}
			$this->expect($this->command($stream, 'MAIL FROM:<' . $from . '>', 'smtp', $transcript), '2');
			$this->expect($this->command($stream, 'RCPT TO:<' . $to . '>', 'smtp', $transcript), '2');
			$this->expect($this->command($stream, 'DATA', 'smtp', $transcript), '3');

			$message = $this->buildMessage($from, $to, $subject, $body);
			// Dot-stuffing: a line that is a single dot would end the message.
			$escaped = preg_replace('/^\./m', '..', $message);
			@fwrite($stream, $escaped . self::CRLF . '.' . self::CRLF);
			$final = $this->readReply($stream, 'smtp', $transcript);
			$this->expect($final, '2');
			$this->command($stream, 'QUIT', 'smtp', $transcript);
			@fclose($stream);
			$this->endpoints->touch($endpoint, 'Test message sent to ' . $to);
			return ['ok' => true, 'to' => $to, 'from' => $from, 'reply' => trim($final), 'transcript' => $this->redact($transcript), 'tls' => $tlsInfo];
		} catch (\Throwable $e) {
			$this->endpoints->touch($endpoint, 'Send failed: ' . $e->getMessage());
			return ['ok' => false, 'to' => $to, 'from' => $from, 'error' => $e->getMessage(), 'transcript' => $this->redact($transcript)];
		}
	}

	private function buildMessage(string $from, string $to, string $subject, string $body): string {
		$subject = $subject !== '' ? $subject : 'NetBase test message';
		$encoded = '=?UTF-8?B?' . base64_encode($subject) . '?=';
		$domain = substr(strrchr($from, '@') ?: '@localhost', 1);
		$headers = [
			'Date: ' . date('r'),
			'From: <' . $from . '>',
			'To: <' . $to . '>',
			'Subject: ' . $encoded,
			'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $domain . '>',
			'MIME-Version: 1.0',
			'Content-Type: text/plain; charset=UTF-8',
			'Content-Transfer-Encoding: base64',
			'Auto-Submitted: auto-generated',
			'X-Mailer: NetBase for Nextcloud',
		];
		$text = $body !== '' ? $body : "This is a test message sent by NetBase to check that this server accepts and delivers mail.\n";
		return implode(self::CRLF, $headers) . self::CRLF . self::CRLF . chunk_split(base64_encode($text), 76, self::CRLF);
	}

	// ------------------------------------------------------------------ plumbing

	private function defaultPort(string $protocol, string $mode): int {
		return match ($protocol) {
			'smtp' => $mode === 'tls' ? 465 : 587,
			'imap' => $mode === 'tls' ? 993 : 143,
			'pop3' => $mode === 'tls' ? 995 : 110,
			default => 25,
		};
	}

	private function heloName(): string {
		$name = gethostname();
		return is_string($name) && $name !== '' && str_contains($name, '.') ? $name : (is_string($name) && $name !== '' ? $name : 'nextcloud.local');
	}

	/** @param array<string, mixed>|null $tlsInfo */
	private function connect(string $host, int $port, bool $implicitTls, float $timeout, &$tlsInfo = null) {
		$errno = 0;
		$errstr = '';
		$target = str_contains($host, ':') && filter_var($host, FILTER_VALIDATE_IP) !== false ? '[' . $host . ']' : $host;
		$context = stream_context_create(['ssl' => [
			'capture_peer_cert' => true,
			'verify_peer' => false,
			'verify_peer_name' => false,
			'SNI_enabled' => true,
			'peer_name' => $host,
		]]);
		$scheme = $implicitTls ? 'ssl://' : 'tcp://';
		$stream = @stream_socket_client($scheme . $target . ':' . $port, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $context);
		if ($stream === false) {
			throw new \RuntimeException($errstr !== '' ? $errstr : 'Could not connect to ' . $host . ':' . $port);
		}
		stream_set_timeout($stream, (int)$timeout);
		$tlsInfo = $implicitTls ? $this->describeTls($stream, $host) : null;
		return $stream;
	}

	private function enableCrypto($stream, string $host): array {
		$ok = @stream_socket_enable_crypto($stream, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
		if ($ok !== true) {
			throw new \RuntimeException('The TLS handshake failed after STARTTLS');
		}
		return $this->describeTls($stream, $host);
	}

	/** @return array<string, mixed> */
	private function describeTls($stream, string $host): array {
		$params = stream_context_get_params($stream);
		$meta = stream_get_meta_data($stream);
		$crypto = $meta['crypto'] ?? [];
		$out = [
			'protocol' => $crypto['protocol'] ?? null,
			'cipher' => $crypto['cipher_name'] ?? null,
			'bits' => $crypto['cipher_bits'] ?? null,
		];
		$cert = $params['options']['ssl']['peer_certificate'] ?? null;
		if ($cert !== null) {
			$parsed = @openssl_x509_parse($cert) ?: [];
			$names = [];
			foreach (explode(',', (string)($parsed['extensions']['subjectAltName'] ?? '')) as $entry) {
				$entry = trim($entry);
				if (str_starts_with($entry, 'DNS:')) {
					$names[] = substr($entry, 4);
				}
			}
			$validTo = isset($parsed['validTo_time_t']) ? (int)$parsed['validTo_time_t'] : null;
			$out += [
				'subject' => $parsed['subject']['CN'] ?? null,
				'issuer' => $parsed['issuer']['CN'] ?? ($parsed['issuer']['O'] ?? null),
				'validFrom' => isset($parsed['validFrom_time_t']) ? (int)$parsed['validFrom_time_t'] : null,
				'validTo' => $validTo,
				'expiresIn' => $validTo !== null ? (int)floor(($validTo - time()) / 86400) : null,
				'names' => $names,
				'nameMatches' => $this->certCovers($host, $parsed['subject']['CN'] ?? '', $names),
			];
		}
		return $out;
	}

	/** @param list<string> $names */
	private function certCovers(string $host, string $cn, array $names): bool {
		$candidates = array_filter(array_merge([$cn], $names));
		foreach ($candidates as $candidate) {
			$pattern = '/^' . str_replace('\*', '[^.]+', preg_quote($candidate, '/')) . '$/i';
			if (preg_match($pattern, $host) === 1) {
				return true;
			}
		}
		return false;
	}

	/** @param array<int, string> $transcript */
	private function command($stream, string $line, string $protocol, array &$transcript, bool $secret = false, bool $multiline = false): string {
		$transcript[] = '> ' . ($secret ? preg_replace('/\s+\S+$/', ' ********', $line) : $line);
		@fwrite($stream, $line . self::CRLF);
		return $this->readReply($stream, $protocol, $transcript, $multiline);
	}

	/** @param array<int, string> $transcript */
	private function readReply($stream, string $protocol, array &$transcript, bool $multiline = false): string {
		$lines = [];
		while (true) {
			$line = @fgets($stream, 8192);
			if ($line === false) {
				break;
			}
			$lines[] = rtrim($line, "\r\n");
			$trimmed = rtrim($line, "\r\n");
			if ($protocol === 'smtp') {
				// "250-" continues, "250 " ends.
				if (preg_match('/^\d{3} /', $trimmed)) {
					break;
				}
			} elseif ($protocol === 'imap') {
				if (preg_match('/^(a\d+|\*) (OK|NO|BAD)/i', $trimmed) && !str_starts_with($trimmed, '* ')) {
					break;
				}
				if (preg_match('/^\* (OK|BYE|PREAUTH)/i', $trimmed) && count($lines) === 1) {
					break;
				}
			} else {
				// POP3: a failure is always one line; a success is one line too
				// unless the command is one of the listing ones, which end on a
				// bare dot.
				if (count($lines) === 1 && (str_starts_with($trimmed, '-ERR') || !$multiline)) {
					break;
				}
				if ($trimmed === '.') {
					break;
				}
			}
			if (count($lines) > 400) {
				break;
			}
		}
		$reply = implode("\n", $lines);
		foreach ($lines as $line) {
			$transcript[] = '< ' . $line;
		}
		if ($reply === '') {
			$meta = stream_get_meta_data($stream);
			throw new \RuntimeException(!empty($meta['timed_out']) ? 'The server did not answer in time' : 'The server closed the connection');
		}
		return $reply;
	}

	/** @return array<string, string|bool> */
	private function smtpCapabilities(string $reply): array {
		$caps = [];
		foreach (explode("\n", $reply) as $line) {
			if (!preg_match('/^250[- ](.*)$/', trim($line), $m)) {
				continue;
			}
			$part = trim($m[1]);
			if ($part === '' || !str_contains($part, ' ')) {
				if ($part !== '' && !str_contains($part, '.')) {
					$caps[strtoupper($part)] = true;
				}
				continue;
			}
			[$name, $value] = explode(' ', $part, 2);
			$caps[strtoupper($name)] = $value;
		}
		unset($caps['']);
		return $caps;
	}

	/** @return list<string> */
	private function imapCapabilities(string $reply): array {
		foreach (explode("\n", $reply) as $line) {
			if (preg_match('/^\*\s+CAPABILITY\s+(.*)$/i', trim($line), $m)) {
				return array_values(array_filter(preg_split('/\s+/', strtoupper(trim($m[1]))) ?: []));
			}
		}
		return [];
	}

	/** @param array<string, string|bool> $caps */
	private function smtpAuth($stream, array $caps, string $user, string $pass, array &$transcript): void {
		$offered = isset($caps['AUTH']) && is_string($caps['AUTH']) ? array_map('strtoupper', preg_split('/\s+/', trim($caps['AUTH'])) ?: []) : [];
		if ($user === '') {
			return;
		}
		if ($offered === []) {
			throw new \RuntimeException('The server offers no AUTH mechanism on this port');
		}
		if (in_array('PLAIN', $offered, true)) {
			$token = base64_encode("\0" . $user . "\0" . $pass);
			$reply = $this->command($stream, 'AUTH PLAIN ' . $token, 'smtp', $transcript, true);
			$this->expect($reply, '2', 'Authentication failed');
			return;
		}
		if (in_array('LOGIN', $offered, true)) {
			$this->expect($this->command($stream, 'AUTH LOGIN', 'smtp', $transcript), '3', 'Authentication failed');
			$this->expect($this->command($stream, base64_encode($user), 'smtp', $transcript, true), '3', 'Authentication failed');
			$this->expect($this->command($stream, base64_encode($pass), 'smtp', $transcript, true), '2', 'Authentication failed');
			return;
		}
		throw new \RuntimeException('Only ' . implode(', ', $offered) . ' offered; NetBase can use PLAIN or LOGIN');
	}

	private function expect(string $reply, string $prefix, string $message = 'Unexpected reply'): void {
		$first = trim(strtok($reply, "\n") ?: '');
		if (!str_starts_with($first, $prefix)) {
			throw new \RuntimeException($message . ': ' . $first);
		}
	}

	private function imapQuote(string $value): string {
		return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $value) . '"';
	}

	/**
	 * @param array<int, string> $transcript
	 * @return array<int, string>
	 */
	private function redact(array $transcript): array {
		return array_map(static function (string $line) {
			if (preg_match('/^> (AUTH (PLAIN|LOGIN)|PASS|a\d+ LOGIN)/i', $line)) {
				return preg_replace('/(\s)\S+$/', '$1********', $line);
			}
			if (preg_match('/^> [A-Za-z0-9+\/]{16,}={0,2}$/', $line)) {
				return '> ********';
			}
			return $line;
		}, $transcript);
	}

	/** @return array<string, string> */
	private function finding(string $level, string $area, string $text): array {
		return ['level' => $level, 'area' => $area, 'text' => $text];
	}

	/** @param array<int, array<string, mixed>> $findings */
	private function score(array $findings): array {
		$counts = ['bad' => 0, 'warn' => 0, 'info' => 0, 'ok' => 0];
		foreach ($findings as $finding) {
			$counts[$finding['level']] = ($counts[$finding['level']] ?? 0) + 1;
		}
		return $counts;
	}
}
