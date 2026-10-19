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
			// The include's own DNS lookup is already in $lookups (counted when the
			// term was seen), and countSpfLookups() also counts that fetch as its
			// first lookup — so add only the FURTHER lookups it pulls in, or a
			// working record with a few includes reads as over the limit.
			$nested += max(0, $this->countSpfLookups($include, 1) - 1);
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
		$host = $this->tools->reach($host);
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
			$result['error'] = $this->l->said($e);
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
		$host = $this->tools->reach($host);
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
			return ['host' => $host, 'port' => $port ?: 25, 'openRelay' => null, 'error' => $this->l->said($e), 'transcript' => $transcript, 'findings' => []];
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
		// checked again where it is used: a connection may have been saved before the fence (review X3)
		$host = \OCP\Server::get(ToolService::class)->reach((string)$endpoint->getHost());
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
				if ($mode === 'starttls' && $tlsInfo === null) {
					throw new \RuntimeException('STARTTLS was not established, so the password would be sent in the clear — stopped. Use TLS, or a port that offers STARTTLS.');
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
				if ($mode === 'starttls' && $tlsInfo === null) {
					throw new \RuntimeException('STARTTLS was not established, so the password would be sent in the clear — stopped. Use TLS, or a port that offers STARTTLS.');
				}
				$reply = $this->command($stream, 'a3 LOGIN ' . $this->imapQuote($user) . ' ' . $this->imapQuote($pass), 'imap', $transcript, true);
				if (!preg_match('/^a3 OK/mi', $reply)) {
					throw new WordedRuntimeException('Sign-in refused: %s', [trim(strtok($reply, "\n"))]);
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
				if ($mode === 'starttls' && $tlsInfo === null) {
					throw new \RuntimeException('STARTTLS was not established, so the password would be sent in the clear — stopped. Use TLS, or a port that offers STARTTLS.');
				}
				$reply = $this->command($stream, 'USER ' . $user, 'pop3', $transcript);
				$reply = $this->command($stream, 'PASS ' . $pass, 'pop3', $transcript, true);
				if (!str_starts_with(trim($reply), '+OK')) {
					throw new WordedRuntimeException('Sign-in refused: %s', [trim($reply)]);
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
			$out['error'] = $this->l->said($e);
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
		// One address is one record: a mailbox account carries the server it
		// sends through alongside the one it is read from. An SMTP-only
		// connection is a relay with no mailbox, and sends from its own fields.
		$kind = (string)$endpoint->getKind();
		if (!in_array($kind, ['smtp', 'imap', 'pop3'], true)) {
			throw new \InvalidArgumentException('Not an SMTP connection');
		}
		if (filter_var($to, FILTER_VALIDATE_EMAIL) === false) {
			throw new \InvalidArgumentException('The recipient is not a valid address');
		}
		$from = $this->senderOf($endpoint);
		try {
			$sent = $this->smtpDeliver($endpoint, $from, [$to], $this->buildMessage($from, $to, $subject, $body), $timeout);
			$this->endpoints->touch($endpoint, 'Test message sent to ' . $to);
			return ['ok' => true, 'to' => $to, 'from' => $from, 'reply' => $sent['reply'], 'transcript' => $sent['transcript'], 'tls' => $sent['tls']];
		} catch (\Throwable $e) {
			$this->endpoints->touch($endpoint, 'Send failed: ' . $e->getMessage());
			return ['ok' => false, 'to' => $to, 'from' => $from, 'error' => $this->l->said($e), 'transcript' => []];
		}
	}

	// ------------------------------------------------------------------ writing and filing

	/** The most attached to one message, in bytes. */
	private const ATTACH_MAX = 26214400;

	/**
	 * A message written here — new, a reply or a forward — sent through the
	 * connection's outgoing server.
	 *
	 * Attachments come from the reader's Nextcloud files, or, for a forward,
	 * from the message being forwarded. Where the mailbox is IMAP a copy is
	 * filed in its Sent folder, as a mail program does, and the message replied
	 * to or forwarded is marked so. A server that files sent mail by itself
	 * (Gmail) would then hold two copies, so the copy can be turned off.
	 *
	 * @param array<string, mixed> $mail
	 * @return array<string, mixed>
	 */
	public function compose(EndpointEntity $endpoint, string $userId, array $mail, float $timeout = 60.0): array {
		$to = self::addresses((string)($mail['to'] ?? ''));
		$cc = self::addresses((string)($mail['cc'] ?? ''));
		$bcc = self::addresses((string)($mail['bcc'] ?? ''));
		foreach (array_merge($to, $cc, $bcc) as $a) {
			if (filter_var($a['address'], FILTER_VALIDATE_EMAIL, FILTER_FLAG_EMAIL_UNICODE) === false) {
				throw new \InvalidArgumentException($this->l->t('%s is not a mail address.', [$a['address']]));
			}
		}
		if ($to === [] && $cc === [] && $bcc === []) {
			throw new \InvalidArgumentException($this->l->t('Enter at least one address to send to.'));
		}
		$from = $this->senderOf($endpoint);
		$files = [];
		$bytes = 0;
		foreach ((array)($mail['attach'] ?? []) as $a) {
			$file = $this->attachmentFor($endpoint, $userId, (array)$a, $timeout);
			$bytes += strlen($file['data']);
			if ($bytes > self::ATTACH_MAX) {
				throw new \RuntimeException($this->l->t('The attachments come to more than %s, more than most servers accept in one message.', ['25 MB']));
			}
			$files[] = $file;
		}
		[$message, $messageId] = $this->buildMail($from, $to, $cc, (string)($mail['subject'] ?? ''), (string)($mail['body'] ?? ''), $files,
			(string)($mail['inReplyTo'] ?? ''), (string)($mail['references'] ?? ''));
		$rcpts = array_values(array_unique(array_map(static fn (array $a): string => $a['address'], array_merge($to, $cc, $bcc))));
		$sent = $this->smtpDeliver($endpoint, $from, $rcpts, $message, $timeout);
		$this->endpoints->touch($endpoint, 'Sent a message to ' . implode(', ', array_slice($rcpts, 0, 3)));
		$filed = null;
		$note = '';
		if ((string)$endpoint->getKind() === 'imap' && (!empty($mail['saveSent']) || !empty($mail['answered']) || !empty($mail['forwarded']))) {
			// The message has gone; what follows is filing, and a failure there
			// must not read as a failure to send.
			try {
				[$stream] = $this->signIn($endpoint, $timeout);
				try {
					if (!empty($mail['saveSent'])) {
						$sentBox = self::specialFolder($this->imapFolders($stream), 'sent');
						if ($sentBox !== null && $this->imapAppend($stream, $sentBox, $message, '(\\Seen)')) {
							$filed = $sentBox;
						} else {
							$note = $this->l->t('Sent, but no Sent folder was found to keep a copy in.');
						}
					}
					foreach (['answered' => '\\Answered', 'forwarded' => '$Forwarded'] as $key => $flag) {
						$which = (array)($mail[$key] ?? []);
						if (isset($which['folder'], $which['ref']) && preg_match('/^uid:(\d+)$/', (string)$which['ref'], $m)) {
							$this->imapSelect($stream, (string)$which['folder']);
							$this->imapExchange($stream, 'f1', 'UID STORE ' . $m[1] . ' +FLAGS.SILENT (' . $flag . ')');
						}
					}
					$this->imapExchange($stream, 'f9', 'LOGOUT');
				} finally {
					@fclose($stream);
				}
			} catch (\Throwable $e) {
				$note = $this->l->t('Sent, but the copy could not be filed: %s', [$this->l->said($e)]);
			}
		}
		return ['ok' => true, 'to' => $rcpts, 'from' => $from, 'messageId' => $messageId, 'savedTo' => $filed, 'note' => $note, 'reply' => $sent['reply']];
	}

	/**
	 * Mark, file or delete messages: read and unread, flagged and not, moved to
	 * another folder, or deleted. In IMAP a deleted message goes to the Trash
	 * folder where there is one, and only from there (or where there is none)
	 * is it removed for good. In POP3 deleting removes it from the server.
	 *
	 * @param list<string> $refs
	 * @return array<string, mixed>
	 */
	public function mailAction(EndpointEntity $endpoint, string $action, string $folder, array $refs, string $target = '', float $timeout = 30.0): array {
		[$stream, $kind] = $this->signIn($endpoint, $timeout);
		try {
			if ($kind === 'pop3') {
				if ($action !== 'delete') {
					throw new \InvalidArgumentException($this->l->t('A POP3 mailbox has no folders or marks; messages can only be read and deleted.'));
				}
				$uidl = $this->popMap($stream, 'UIDL');
				$done = 0;
				foreach ($refs as $ref) {
					if (!preg_match('/^pop:(\d+):(.*)$/', $ref, $m) || ($m[2] !== '' && ($uidl[(int)$m[1]] ?? null) !== $m[2])) {
						continue;
					}
					if (str_starts_with(trim($this->popLine($stream, 'DELE ' . (int)$m[1])), '+OK')) {
						$done++;
					}
				}
				// The deletions take effect only when the session ends properly.
				$this->popLine($stream, 'QUIT');
				return ['done' => $done, 'permanent' => true];
			}
			$uids = [];
			foreach ($refs as $ref) {
				if (preg_match('/^uid:(\d+)$/', $ref, $m)) {
					$uids[] = $m[1];
				}
			}
			if ($uids === []) {
				throw new \InvalidArgumentException('Unknown message');
			}
			$set = implode(',', $uids);
			$caps = $this->imapCapabilities(implode("\n", array_map(static fn (array $u): string => $u[0], $this->imapExchange($stream, 'c1', 'CAPABILITY')[1])));
			$folders = $this->imapFolders($stream);
			$this->imapSelect($stream, $folder !== '' ? $folder : 'INBOX');
			$store = function (string $how) use ($stream, $set): void {
				[$status] = $this->imapExchange($stream, 's1', 'UID STORE ' . $set . ' ' . $how);
				if (!preg_match('/^s1 OK/i', $status)) {
					throw new \RuntimeException($this->l->t('The server refused: %s', [$status]));
				}
			};
			$move = function (string $to) use ($stream, $set, $caps, $store): void {
				if (in_array('MOVE', $caps, true)) {
					[$status] = $this->imapExchange($stream, 'm1', 'UID MOVE ' . $set . ' ' . $this->imapQuote($to));
					if (!preg_match('/^m1 OK/i', $status)) {
						throw new \RuntimeException($this->l->t('The server refused: %s', [$status]));
					}
					return;
				}
				[$status] = $this->imapExchange($stream, 'm2', 'UID COPY ' . $set . ' ' . $this->imapQuote($to));
				if (!preg_match('/^m2 OK/i', $status)) {
					throw new \RuntimeException($this->l->t('The server refused: %s', [$status]));
				}
				$store('+FLAGS.SILENT (\\Deleted)');
				// Only these messages are removed: a plain EXPUNGE would also remove
				// any other message another program had marked for deletion.
				if (in_array('UIDPLUS', $caps, true)) {
					$this->imapExchange($stream, 'm3', 'UID EXPUNGE ' . $set);
				}
			};
			$out = ['done' => count($uids)];
			switch ($action) {
				case 'seen': $store('+FLAGS.SILENT (\\Seen)'); break;
				case 'unseen': $store('-FLAGS.SILENT (\\Seen)'); break;
				case 'flag': $store('+FLAGS.SILENT (\\Flagged)'); break;
				case 'unflag': $store('-FLAGS.SILENT (\\Flagged)'); break;
				case 'move':
					if ($target === '' || !in_array($target, array_column($folders, 'name'), true)) {
						throw new \InvalidArgumentException($this->l->t('Choose a folder to move to.'));
					}
					$move($target);
					$out['movedTo'] = $target;
					break;
				case 'delete':
					$trash = self::specialFolder($folders, 'trash');
					if ($trash !== null && strcasecmp($trash, $folder !== '' ? $folder : 'INBOX') !== 0) {
						$move($trash);
						$out['movedTo'] = $trash;
						break;
					}
					$store('+FLAGS.SILENT (\\Deleted)');
					$this->imapExchange($stream, 'e1', in_array('UIDPLUS', $caps, true) ? 'UID EXPUNGE ' . $set : 'EXPUNGE');
					$out['permanent'] = true;
					break;
				default:
					throw new \InvalidArgumentException('Unknown action');
			}
			$this->imapExchange($stream, 'z9', 'LOGOUT');
			return $out;
		} finally {
			@fclose($stream);
		}
	}

	/** The address mail is sent from, as send() has always worked it out. */
	private function senderOf(EndpointEntity $endpoint): string {
		$from = (string)$this->endpoints->option($endpoint, 'from', '');
		if ($from === '' || filter_var($from, FILTER_VALIDATE_EMAIL) === false) {
			$from = (string)$endpoint->getUsername();
		}
		if (filter_var($from, FILTER_VALIDATE_EMAIL) === false) {
			throw new \InvalidArgumentException('This connection has no valid sender address. Set one in the connection settings.');
		}
		return $from;
	}

	/**
	 * One attachment for a message being written.
	 *
	 * @param array<string, mixed> $a
	 * @return array{name: string, type: string, data: string}
	 */
	private function attachmentFor(EndpointEntity $endpoint, string $userId, array $a, float $timeout): array {
		if (($a['kind'] ?? '') === 'original') {
			return $this->attachment($endpoint, (string)($a['folder'] ?? ''), (string)($a['ref'] ?? ''), (int)($a['index'] ?? 0), $timeout);
		}
		$path = trim(str_replace(["\0", "\r", "\n"], '', (string)($a['path'] ?? '')), '/');
		try {
			$node = \OCP\Server::get(\OCP\Files\IRootFolder::class)->getUserFolder($userId)->get($path);
		} catch (\Throwable $e) {
			$node = null;
		}
		if (!$node instanceof \OCP\Files\File || $path === '') {
			throw new \RuntimeException($this->l->t('%s is no longer there.', [basename($path)]));
		}
		if ($node->getSize() > self::ATTACH_MAX) {
			throw new \RuntimeException($this->l->t('The attachments come to more than %s, more than most servers accept in one message.', ['25 MB']));
		}
		return ['name' => $node->getName(), 'type' => $node->getMimetype() ?: 'application/octet-stream', 'data' => $node->getContent()];
	}

	/**
	 * Addresses as people type them and headers carry them: "Name <a@b>",
	 * "\"Sato, Taro\" <a@b>" or a bare a@b, separated by commas or semicolons.
	 *
	 * @return list<array{name: string, address: string}>
	 */
	public static function addresses(string $list): array {
		$out = [];
		$parts = [];
		$cur = '';
		$quoted = false;
		$angle = false;
		for ($i = 0, $n = strlen($list); $i < $n; $i++) {
			$ch = $list[$i];
			if ($ch === '"' && ($i === 0 || $list[$i - 1] !== '\\')) {
				$quoted = !$quoted;
			} elseif (!$quoted && $ch === '<') {
				$angle = true;
			} elseif (!$quoted && $ch === '>') {
				$angle = false;
			} elseif (!$quoted && !$angle && ($ch === ',' || $ch === ';' || $ch === "\n")) {
				$parts[] = $cur;
				$cur = '';
				continue;
			}
			$cur .= $ch;
		}
		$parts[] = $cur;
		foreach ($parts as $p) {
			$p = trim($p);
			if ($p === '' || preg_match('/^[^<@]*:\s*$/', $p)) {
				continue; // empty, or a group's name ("undisclosed-recipients:")
			}
			if (preg_match('/^(.*)<([^<>]+)>\s*$/s', $p, $m)) {
				$name = trim($m[1]);
				if (strlen($name) >= 2 && $name[0] === '"' && str_ends_with($name, '"')) {
					$name = stripcslashes(substr($name, 1, -1));
				}
				$out[] = ['name' => $name, 'address' => trim($m[2])];
			} else {
				$out[] = ['name' => '', 'address' => trim($p, " \t<>")];
			}
		}
		return $out;
	}

	/** One address for a header, its name encoded when it is not plain ASCII. */
	private static function headerAddress(array $a): string {
		$name = trim((string)$a['name']);
		if ($name === '') {
			return '<' . $a['address'] . '>';
		}
		if (preg_match('/[^\x20-\x7E]/', $name)) {
			$name = mb_encode_mimeheader($name, 'UTF-8', 'B', "\r\n");
		} elseif (preg_match('/[(),.:;<>@\[\]"\\\\]/', $name)) {
			$name = '"' . addcslashes($name, '"\\') . '"';
		}
		return $name . ' <' . $a['address'] . '>';
	}

	/**
	 * The message as it is sent: plain UTF-8 text, and the attachments if any.
	 *
	 * @param list<array{name: string, address: string}> $to
	 * @param list<array{name: string, address: string}> $cc
	 * @param list<array{name: string, type: string, data: string}> $files
	 * @return array{0: string, 1: string} the message and its Message-ID
	 */
	private function buildMail(string $from, array $to, array $cc, string $subject, string $body, array $files, string $inReplyTo, string $references): array {
		$domain = substr(strrchr($from, '@') ?: '@localhost', 1);
		$messageId = '<' . bin2hex(random_bytes(12)) . '@' . $domain . '>';
		$clean = static fn (string $v): string => trim(str_replace(["\r", "\n"], ' ', $v));
		$headers = [
			'Date: ' . date('r'),
			'From: <' . $from . '>',
		];
		if ($to !== []) {
			$headers[] = 'To: ' . implode(',' . self::CRLF . ' ', array_map([self::class, 'headerAddress'], $to));
		}
		if ($cc !== []) {
			$headers[] = 'Cc: ' . implode(',' . self::CRLF . ' ', array_map([self::class, 'headerAddress'], $cc));
		}
		$subject = $clean($subject);
		$headers[] = 'Subject: ' . ($subject === '' ? '' : (preg_match('/[^\x20-\x7E]/', $subject) ? mb_encode_mimeheader($subject, 'UTF-8', 'B', self::CRLF) : $subject));
		$headers[] = 'Message-ID: ' . $messageId;
		if (preg_match('/^<[^<>\s]+>$/', $clean($inReplyTo))) {
			$headers[] = 'In-Reply-To: ' . $clean($inReplyTo);
			$refs = trim($clean($references) . ' ' . $clean($inReplyTo));
			$headers[] = 'References: ' . implode(self::CRLF . ' ', array_slice(preg_split('/\s+/', $refs) ?: [], -20));
		}
		$headers[] = 'MIME-Version: 1.0';
		$headers[] = 'X-Mailer: NetBase for Nextcloud';
		$text = str_replace(["\r\n", "\r"], "\n", $body);
		$text = str_replace("\n", self::CRLF, $text);
		$textPart = 'Content-Type: text/plain; charset=UTF-8' . self::CRLF . 'Content-Transfer-Encoding: base64' . self::CRLF . self::CRLF
			. chunk_split(base64_encode($text), 76, self::CRLF);
		if ($files === []) {
			return [implode(self::CRLF, $headers) . self::CRLF . $textPart, $messageId];
		}
		$boundary = '=_netbase_' . bin2hex(random_bytes(12));
		$headers[] = 'Content-Type: multipart/mixed; boundary="' . $boundary . '"';
		$out = implode(self::CRLF, $headers) . self::CRLF . self::CRLF . 'This is a message in MIME format.' . self::CRLF
			. '--' . $boundary . self::CRLF . $textPart;
		foreach ($files as $f) {
			$name = str_replace(['"', "\r", "\n", '\\'], '', (string)$f['name']);
			$type = preg_match('#^[\w.+-]+/[\w.+-]+$#', (string)$f['type']) ? (string)$f['type'] : 'application/octet-stream';
			// RFC 2231 for programs that read it, and an encoded word for the
			// many (older Outlook among them) that only read the plain form.
			$legacy = preg_match('/[^\x20-\x7E]/', $name) ? mb_encode_mimeheader($name, 'UTF-8', 'B', '') : $name;
			$out .= '--' . $boundary . self::CRLF
				. 'Content-Type: ' . $type . '; name="' . $legacy . '"' . self::CRLF
				. 'Content-Disposition: attachment; filename="' . $legacy . '";' . self::CRLF . ' filename*=UTF-8\'\'' . rawurlencode($name) . self::CRLF
				. 'Content-Transfer-Encoding: base64' . self::CRLF . self::CRLF
				. chunk_split(base64_encode((string)$f['data']), 76, self::CRLF);
		}
		return [$out . '--' . $boundary . '--' . self::CRLF, $messageId];
	}

	/**
	 * Hand a finished message to the connection's outgoing server.
	 *
	 * @param list<string> $rcpts
	 * @return array{reply: string, transcript: list<string>, tls: mixed}
	 */
	private function smtpDeliver(EndpointEntity $endpoint, string $from, array $rcpts, string $message, float $timeout): array {
		$kind = (string)$endpoint->getKind();
		if (!in_array($kind, ['smtp', 'imap', 'pop3'], true)) {
			throw new \InvalidArgumentException('Not an SMTP connection');
		}
		// checked again where it is used: a connection may have been saved before the fence (review X3)
		$host = \OCP\Server::get(ToolService::class)->reach((string)$endpoint->getHost());
		$port = (int)$endpoint->getPort() ?: 587;
		$mode = (string)$this->endpoints->option($endpoint, 'mode', 'starttls');
		if ($kind !== 'smtp') {
			// A mailbox account: its own host and port are where mail is read,
			// so sending uses the outgoing server kept beside them. Left blank,
			// one machine answers for both — a common arrangement, and the only
			// sensible guess.
			$mode = (string)$this->endpoints->option($endpoint, 'sendMode', 'starttls');
			$sendHost = trim((string)$this->endpoints->option($endpoint, 'sendHost', ''));
			if ($sendHost !== '') {
				$host = \OCP\Server::get(ToolService::class)->reach($sendHost);
			}
			$sendPort = (int)$this->endpoints->option($endpoint, 'sendPort', 0);
			$port = $sendPort > 0 ? $sendPort : $this->defaultPort('smtp', $mode);
		}
		$transcript = [];
		$tlsInfo = null;
		$stream = $this->connect($host, $port, $mode === 'tls', $timeout, $tlsInfo);
		try {
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
				if ($mode === 'starttls' && $tlsInfo === null) {
					throw new \RuntimeException('STARTTLS was not established, so the password would be sent in the clear — the message was not sent. Use TLS, or a port that offers STARTTLS.');
				}
				$this->smtpAuth($stream, $caps, (string)$endpoint->getUsername(), $this->endpoints->secret($endpoint), $transcript);
			}
			$this->expect($this->command($stream, 'MAIL FROM:<' . $from . '>', 'smtp', $transcript), '2');
			foreach ($rcpts as $r) {
				$this->expect($this->command($stream, 'RCPT TO:<' . $r . '>', 'smtp', $transcript), '2', $this->l->t('The server would not take mail for %s', [$r]));
			}
			$this->expect($this->command($stream, 'DATA', 'smtp', $transcript), '3');
			// Dot-stuffing: a line that is a single dot would end the message.
			@fwrite($stream, preg_replace('/^\./m', '..', $message) . self::CRLF . '.' . self::CRLF);
			$final = $this->readReply($stream, 'smtp', $transcript);
			$this->expect($final, '2');
			$this->command($stream, 'QUIT', 'smtp', $transcript);
			return ['reply' => trim($final), 'transcript' => $this->redact($transcript), 'tls' => $tlsInfo];
		} finally {
			@fclose($stream);
		}
	}

	/** Open a folder to change things in it; the number of messages. */
	private function imapSelect($stream, string $folder): int {
		[$status, $untagged] = $this->imapExchange($stream, 'r2', 'SELECT ' . $this->imapQuote($folder));
		if (!preg_match('/^r2 OK/i', $status)) {
			throw new \RuntimeException($this->l->t('The folder %s could not be opened.', [$folder]));
		}
		foreach ($untagged as [$text]) {
			if (preg_match('/^\* (\d+) EXISTS/i', $text, $m)) {
				return (int)$m[1];
			}
		}
		return 0;
	}

	/** Put a whole message into a folder (a copy of what was sent). */
	private function imapAppend($stream, string $folder, string $message, string $flags): bool {
		@fwrite($stream, 'p1 APPEND ' . $this->imapQuote($folder) . ' ' . $flags . ' {' . strlen($message) . '}' . self::CRLF);
		$line = @fgets($stream, 65536);
		if ($line === false || !str_starts_with($line, '+')) {
			return false;
		}
		@fwrite($stream, $message . self::CRLF);
		while (($line = @fgets($stream, 65536)) !== false) {
			if (str_starts_with($line, 'p1 ')) {
				return (bool)preg_match('/^p1 OK/i', $line);
			}
		}
		return false;
	}

	/**
	 * The folder a mailbox uses for sent mail, or the trash: the one the server
	 * names so (SPECIAL-USE), or else one whose name says it.
	 *
	 * @param list<array{name: string, label: string, use?: string}> $folders
	 */
	public static function specialFolder(array $folders, string $use): ?string {
		foreach ($folders as $f) {
			if (($f['use'] ?? '') === $use) {
				return $f['name'];
			}
		}
		$names = [
			'sent' => '/^(?:inbox[.\/])?(?:sent|sent items|sent messages|sent mail|送信済み|送信済みアイテム|送信済みメール|送信箱)$/iu',
			'trash' => '/^(?:inbox[.\/])?(?:trash|deleted|deleted items|deleted messages|bin|ゴミ箱|ごみ箱|削除済み|削除済みアイテム)$/iu',
		][$use] ?? null;
		if ($names === null) {
			return null;
		}
		foreach ($folders as $f) {
			if (preg_match($names, $f['label']) || preg_match($names, $f['name'])) {
				return $f['name'];
			}
		}
		return null;
	}

	// ------------------------------------------------------------------ reading

	/** The largest message opened for reading, in bytes. */
	private const READ_MAX = 26214400;

	/**
	 * The newest messages in a mailbox, the way a mail program lists them.
	 *
	 * Reading changes nothing: IMAP opens the folder read-only (EXAMINE) and
	 * fetches with BODY.PEEK, so nothing is marked as read; POP3 never deletes.
	 *
	 * @return array<string, mixed>
	 */
	public function messages(EndpointEntity $endpoint, string $folder = '', int $offset = 0, int $limit = 50, float $timeout = 20.0, string $search = ''): array {
		$limit = max(1, min(200, $limit));
		$offset = max(0, $offset);
		[$stream, $kind] = $this->signIn($endpoint, $timeout);
		try {
			if ($kind === 'imap') {
				$folders = $this->imapFolders($stream);
				$folder = $folder !== '' ? $folder : 'INBOX';
				$total = $this->imapExamine($stream, $folder);
				$messages = [];
				$items = ' (UID FLAGS RFC822.SIZE INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE CONTENT-TYPE)])';
				$fetch = null;
				if (trim($search) !== '') {
					// Searching: the server finds the messages (subject, sender or
					// recipient), and the newest of them are listed as usual.
					$caps = $this->imapCapabilities(implode("\n", array_map(static fn (array $u): string => $u[0], $this->imapExchange($stream, 'c1', 'CAPABILITY')[1])));
					$uids = $this->imapSearch($stream, $caps, $search);
					rsort($uids, SORT_NUMERIC);
					$total = count($uids);
					$page = array_slice($uids, $offset, $limit);
					if ($page !== []) {
						$fetch = 'UID FETCH ' . implode(',', $page) . $items;
					}
				} elseif ($total - $offset >= 1) {
					$end = $total - $offset;
					$fetch = 'FETCH ' . max(1, $end - $limit + 1) . ':' . $end . $items;
				}
				if ($fetch !== null) {
					[$status, $untagged] = $this->imapExchange($stream, 'r3', $fetch);
					if (!preg_match('/^r3 OK/i', $status)) {
						throw new \RuntimeException($this->l->t('The server refused to list the messages: %s', [$status]));
					}
					foreach ($untagged as [$text, $literals]) {
						if (!preg_match('/^\* (\d+) FETCH /i', $text, $m)) {
							continue;
						}
						$headers = MimeMessage::headers($literals[0] ?? '');
						$flags = preg_match('/FLAGS \(([^)]*)\)/i', $text, $f) ? strtolower($f[1]) : '';
						$messages[] = $this->summary($headers, [
							'ref' => preg_match('/UID (\d+)/i', $text, $u) ? 'uid:' . $u[1] : 'seq:' . $m[1],
							'n' => (int)$m[1],
							'size' => preg_match('/RFC822\.SIZE (\d+)/i', $text, $sz) ? (int)$sz[1] : null,
							'seen' => str_contains($flags, '\\seen'),
							'flagged' => str_contains($flags, '\\flagged'),
							'answered' => str_contains($flags, '\\answered'),
							'forwarded' => str_contains($flags, '$forwarded'),
							'arrived' => preg_match('/INTERNALDATE "([^"]+)"/i', $text, $d) ? $this->mailDate($d[1]) : null,
						]);
					}
				}
				usort($messages, static fn (array $a, array $b): int => $b['n'] <=> $a['n']);
				$this->imapExchange($stream, 'r9', 'LOGOUT');
				return ['kind' => 'imap', 'folders' => $folders, 'folder' => $folder, 'total' => $total, 'offset' => $offset, 'messages' => $messages, 'search' => trim($search)];
			}
			$total = $this->popCount($stream);
			$uidl = $this->popMap($stream, 'UIDL');
			$sizes = $this->popMap($stream, 'LIST');
			$messages = [];
			for ($n = $total - $offset; $n >= 1 && $n > $total - $offset - $limit; $n--) {
				$headers = MimeMessage::headers((string)$this->popMulti($stream, 'TOP ' . $n . ' 0', 1048576));
				$messages[] = $this->summary($headers, [
					'ref' => 'pop:' . $n . ':' . ($uidl[$n] ?? ''), 'n' => $n,
					'size' => isset($sizes[$n]) ? (int)$sizes[$n] : null, 'seen' => null, 'flagged' => false, 'answered' => false, 'arrived' => null,
				]);
			}
			$this->popLine($stream, 'QUIT');
			return ['kind' => 'pop3', 'folders' => [], 'folder' => '', 'total' => $total, 'offset' => $offset, 'messages' => $messages];
		} finally {
			@fclose($stream);
		}
	}

	/**
	 * One message, ready to read: headers, the text and the HTML, the attachments.
	 *
	 * The HTML is shown in a sandboxed frame in the browser, with no scripts
	 * and nothing fetched from the internet — a picture loaded from the sender's
	 * server tells the sender the message was opened. Pictures carried inside
	 * the message (cid:) are put in place.
	 *
	 * @return array<string, mixed>
	 */
	public function message(EndpointEntity $endpoint, string $folder, string $ref, float $timeout = 30.0, bool $markSeen = false): array {
		$raw = $this->fetchRaw($endpoint, $folder, $ref, $timeout, $markSeen);
		$mail = MimeMessage::parse($raw);
		$h = $mail['headers'];
		$html = $mail['html'];
		$blocked = false;
		if ($html !== null) {
			$budget = 8388608;
			$html = (string)preg_replace_callback('/cid:([^"\'\s)>]+)/i', static function (array $m) use ($mail, &$budget): string {
				$part = $mail['inline'][rawurldecode($m[1])] ?? null;
				if ($part === null || strlen($part['data']) > $budget) {
					return 'about:blank';
				}
				$budget -= strlen($part['data']);
				return 'data:' . $part['type'] . ';base64,' . base64_encode($part['data']);
			}, $html);
			$blocked = (bool)preg_match('/<img[^>]+src\s*=\s*["\']?https?:/i', $html) || (bool)preg_match('/url\(\s*["\']?https?:/i', $html);
		}
		$all = [];
		foreach ($h as $name => $values) {
			foreach ($values as $v) {
				$all[] = [$name, MimeMessage::decodeHeader($v)];
			}
		}
		return [
			'ref' => $ref,
			'subject' => MimeMessage::decodeHeader(MimeMessage::first($h, 'subject')),
			'from' => MimeMessage::decodeHeader(MimeMessage::first($h, 'from')),
			'to' => MimeMessage::decodeHeader(implode(', ', $h['to'] ?? [])),
			'cc' => MimeMessage::decodeHeader(implode(', ', $h['cc'] ?? [])),
			'replyTo' => MimeMessage::decodeHeader(MimeMessage::first($h, 'reply-to')),
			'date' => $this->mailDate(MimeMessage::first($h, 'date')),
			'dateText' => MimeMessage::first($h, 'date'),
			'messageId' => MimeMessage::first($h, 'message-id'),
			'references' => trim(str_replace(["\r", "\n"], ' ', MimeMessage::first($h, 'references'))),
			// The addresses one by one, for reply and reply-all: parsed before
			// their names are decoded, so a comma inside a name stays inside it.
			'fromList' => $this->addressList($h, 'from'),
			'toList' => $this->addressList($h, 'to'),
			'ccList' => $this->addressList($h, 'cc'),
			'replyToList' => $this->addressList($h, 'reply-to'),
			'quote' => ($mail['text'] ?? '') !== '' ? (string)$mail['text'] : ($html !== null ? MimeMessage::htmlToText((string)$mail['html']) : ''),
			'seen' => $markSeen ? true : null,
			'me' => (function () use ($endpoint): string { try { return $this->senderOf($endpoint); } catch (\Throwable $e) { return (string)$endpoint->getUsername(); } })(),
			'size' => strlen($raw),
			'text' => $mail['text'] ?? '',
			'html' => $html,
			'remoteImages' => $blocked,
			'attachments' => $mail['attachments'],
			'headers' => array_slice($all, 0, 300),
		];
	}

	/**
	 * One attachment's bytes, for saving into the reader's files.
	 *
	 * @return array{name: string, type: string, data: string}
	 */
	public function attachment(EndpointEntity $endpoint, string $folder, string $ref, int $index, float $timeout = 30.0): array {
		$mail = MimeMessage::parse($this->fetchRaw($endpoint, $folder, $ref, $timeout), $index);
		if ($mail['wanted'] === null) {
			throw new \RuntimeException($this->l->t('That attachment is no longer in the message.'));
		}
		return $mail['wanted'];
	}

	/** The message as it is stored, by the reference the list gave. */
	private function fetchRaw(EndpointEntity $endpoint, string $folder, string $ref, float $timeout, bool $markSeen = false): string {
		[$stream, $kind] = $this->signIn($endpoint, $timeout);
		try {
			if ($kind === 'imap') {
				if (!preg_match('/^(uid|seq):(\d+)$/', $ref, $m)) {
					throw new \InvalidArgumentException('Unknown message');
				}
				// Opened the way a mail program opens it — marked as read — only
				// when that is asked for; otherwise read-only, changing nothing.
				$markSeen ? $this->imapSelect($stream, $folder !== '' ? $folder : 'INBOX') : $this->imapExamine($stream, $folder !== '' ? $folder : 'INBOX');
				$prefix = $m[1] === 'uid' ? 'UID ' : '';
				[, $untagged] = $this->imapExchange($stream, 'r4', $prefix . 'FETCH ' . $m[2] . ' (RFC822.SIZE)');
				$size = null;
				foreach ($untagged as [$text]) {
					if (preg_match('/RFC822\.SIZE (\d+)/i', $text, $s)) {
						$size = (int)$s[1];
					}
				}
				if ($size === null) {
					throw new \RuntimeException($this->l->t('That message is no longer in the mailbox.'));
				}
				$this->refuseLarge($size);
				[$status, $untagged] = $this->imapExchange($stream, 'r5', $prefix . 'FETCH ' . $m[2] . ($markSeen ? ' (BODY[])' : ' (BODY.PEEK[])'));
				$raw = null;
				foreach ($untagged as [$text, $literals]) {
					if (preg_match('/ FETCH /i', $text) && isset($literals[0])) {
						$raw = $literals[0];
					}
				}
				$this->imapExchange($stream, 'r9', 'LOGOUT');
				if ($raw === null) {
					throw new \RuntimeException($this->l->t('The server refused to hand over the message: %s', [$status]));
				}
				return $raw;
			}
			if (!preg_match('/^pop:(\d+):(.*)$/', $ref, $m)) {
				throw new \InvalidArgumentException('Unknown message');
			}
			$n = (int)$m[1];
			// The number of a POP3 message moves when an earlier one is deleted;
			// its UIDL does not. A number that now names another message is refused.
			if ($m[2] !== '') {
				$uidl = $this->popMap($stream, 'UIDL');
				if (($uidl[$n] ?? null) !== $m[2]) {
					throw new \RuntimeException($this->l->t('That message is no longer in the mailbox.'));
				}
			}
			$sizes = $this->popMap($stream, 'LIST');
			$this->refuseLarge((int)($sizes[$n] ?? 0));
			// TOP with more lines than any message has hands over the whole
			// message. RETR would too, but many servers (Dovecot among them)
			// take a RETR as "this has been read" and mark it so for IMAP — and
			// reading here is to change nothing. Only a server without TOP gets RETR.
			$raw = $this->popMulti($stream, 'TOP ' . $n . ' 999999999', self::READ_MAX + 1048576)
				?? (string)$this->popMulti($stream, 'RETR ' . $n, self::READ_MAX + 1048576);
			$this->popLine($stream, 'QUIT');
			return $raw;
		} finally {
			@fclose($stream);
		}
	}

	/**
	 * A Date header as a time.
	 *
	 * The day of the week is dropped first: strtotime() reads "Fri, 17 Oct"
	 * as "the Friday on or after 17 October", so a sender whose weekday is
	 * wrong — it happens — had the message dated up to six days late. A
	 * trailing comment such as "(JST)" is dropped too.
	 */
	private function mailDate(string $value): ?int {
		$value = trim((string)preg_replace(['/^\s*[A-Za-z]{3,9},\s*/', '/\([^)]*\)\s*$/'], '', $value));
		if ($value === '') {
			return null;
		}
		$t = strtotime($value);
		return $t === false ? null : $t;
	}

	private function refuseLarge(int $size): void {
		if ($size > self::READ_MAX) {
			throw new \RuntimeException($this->l->t('This message is %s. Only messages up to 25 MB are opened here.', [number_format($size / 1048576, 1) . ' MB']));
		}
	}

	/** @param array<string, list<string>> $headers @return array<string, mixed> */
	private function summary(array $headers, array $extra): array {
		$type = strtolower(MimeMessage::first($headers, 'content-type'));
		return $extra + [
			'from' => MimeMessage::decodeHeader(MimeMessage::first($headers, 'from')),
			'to' => MimeMessage::decodeHeader(MimeMessage::first($headers, 'to')),
			'subject' => MimeMessage::decodeHeader(MimeMessage::first($headers, 'subject')),
			'date' => $this->mailDate(MimeMessage::first($headers, 'date')),
			// A good guess, not a promise: multipart/mixed is how attachments arrive.
			'attachment' => str_contains($type, 'multipart/mixed'),
		];
	}

	/**
	 * Sign in the way login() does, and hand back the open connection.
	 *
	 * @return array{0: resource, 1: string}
	 */
	private function signIn(EndpointEntity $endpoint, float $timeout): array {
		$kind = (string)$endpoint->getKind();
		if (!in_array($kind, ['imap', 'pop3'], true)) {
			throw new \InvalidArgumentException($this->l->t('Only an IMAP or POP3 connection has a mailbox to read.'));
		}
		$host = \OCP\Server::get(ToolService::class)->reach((string)$endpoint->getHost());
		$port = (int)$endpoint->getPort() ?: $this->defaultPort($kind, 'tls');
		$mode = (string)$this->endpoints->option($endpoint, 'mode', 'tls');
		$user = (string)$endpoint->getUsername();
		$pass = $this->endpoints->secret($endpoint);
		$transcript = [];
		$stream = $this->connect($host, $port, $mode === 'tls', $timeout, $tlsInfo);
		try {
			$this->readReply($stream, $kind, $transcript);
			if ($kind === 'imap') {
				if ($mode === 'starttls') {
					$reply = $this->command($stream, 'a1 CAPABILITY', 'imap', $transcript);
					if (in_array('STARTTLS', $this->imapCapabilities($reply), true)) {
						$this->command($stream, 'a2 STARTTLS', 'imap', $transcript);
						$tlsInfo = $this->enableCrypto($stream, $host);
					}
				}
				if ($mode === 'starttls' && $tlsInfo === null) {
					throw new \RuntimeException('STARTTLS was not established, so the password would be sent in the clear — stopped. Use TLS, or a port that offers STARTTLS.');
				}
				$reply = $this->command($stream, 'a3 LOGIN ' . $this->imapQuote($user) . ' ' . $this->imapQuote($pass), 'imap', $transcript, true);
				if (!preg_match('/^a3 OK/mi', $reply)) {
					throw new WordedRuntimeException('Sign-in refused: %s', [trim((string)strtok($reply, "\n"))]);
				}
			} else {
				if ($mode === 'starttls') {
					$reply = $this->command($stream, 'CAPA', 'pop3', $transcript, false, true);
					if (str_contains($reply, 'STLS')) {
						$this->command($stream, 'STLS', 'pop3', $transcript);
						$tlsInfo = $this->enableCrypto($stream, $host);
					}
				}
				if ($mode === 'starttls' && $tlsInfo === null) {
					throw new \RuntimeException('STARTTLS was not established, so the password would be sent in the clear — stopped. Use TLS, or a port that offers STARTTLS.');
				}
				$this->command($stream, 'USER ' . $user, 'pop3', $transcript);
				$reply = $this->command($stream, 'PASS ' . $pass, 'pop3', $transcript, true);
				if (!str_starts_with(trim($reply), '+OK')) {
					throw new WordedRuntimeException('Sign-in refused: %s', [trim($reply)]);
				}
			}
		} catch (\Throwable $e) {
			@fclose($stream);
			throw $e;
		}
		$this->endpoints->touch($endpoint, 'Read the mailbox');
		return [$stream, $kind];
	}

	/** @return list<array{name: string, label: string}> */
	private function imapFolders($stream): array {
		[, $untagged] = $this->imapExchange($stream, 'r1', 'LIST "" "*"');
		$out = [];
		foreach ($untagged as [$text, $literals]) {
			if (!preg_match('/^\* LIST \(([^)]*)\) (?:NIL|"(?:[^"\\\\]|\\\\.)*"|\S+) (.*)$/is', $text, $m)) {
				continue;
			}
			if (stripos($m[1], '\\noselect') !== false || stripos($m[1], '\\nonexistent') !== false) {
				continue;
			}
			$name = trim($m[2]);
			if (str_contains($name, "\0")) {
				$name = (string)($literals[0] ?? '');
			} elseif (strlen($name) >= 2 && $name[0] === '"') {
				$name = stripcslashes(substr($name, 1, -1));
			}
			if ($name === '') {
				continue;
			}
			$label = @mb_convert_encoding($name, 'UTF-8', 'UTF7-IMAP');
			$use = '';
			foreach (['sent', 'trash', 'drafts', 'junk', 'archive'] as $u) {
				if (stripos($m[1], '\\' . $u) !== false) {
					$use = $u;
				}
			}
			$out[] = ['name' => $name, 'label' => is_string($label) && $label !== '' ? $label : $name, 'use' => $use];
			if (count($out) >= 500) {
				break;
			}
		}
		usort($out, static fn (array $a, array $b): int => (strcasecmp($a['name'], 'INBOX') === 0 ? -1 : 0) - (strcasecmp($b['name'], 'INBOX') === 0 ? -1 : 0) ?: strcasecmp($a['label'], $b['label']));
		return $out;
	}

	/** Open a folder read-only; the number of messages in it. */
	private function imapExamine($stream, string $folder): int {
		[$status, $untagged] = $this->imapExchange($stream, 'r2', 'EXAMINE ' . $this->imapQuote($folder));
		if (!preg_match('/^r2 OK/i', $status)) {
			throw new \RuntimeException($this->l->t('The folder %s could not be opened.', [$folder]));
		}
		foreach ($untagged as [$text]) {
			if (preg_match('/^\* (\d+) EXISTS/i', $text, $m)) {
				return (int)$m[1];
			}
		}
		return 0;
	}

	/**
	 * One IMAP command and everything said in reply, literals included.
	 *
	 * The line reader the probes use cannot carry a message: a FETCH answer
	 * holds the message as a literal — "{4321}" and then exactly that many
	 * bytes — which may contain anything, lines that look like the end of the
	 * reply among them. Here each literal is read by its count and kept apart;
	 * the line it belongs to keeps a NUL where it was.
	 *
	 * @return array{0: string, 1: list<array{0: string, 1: list<string>}>} the tagged status line, and each untagged reply with its literals
	 */
	private function imapExchange($stream, string $tag, string $command): array {
		@fwrite($stream, $tag . ' ' . $command . self::CRLF);
		return $this->imapRead($stream, $tag);
	}

	/**
	 * The reply to a command already sent, up to its tagged status line.
	 *
	 * @return array{0: string, 1: list<array{0: string, 1: list<string>}>}
	 */
	private function imapRead($stream, string $tag): array {
		$untagged = [];
		$budget = self::READ_MAX + 4194304;
		while (true) {
			$line = @fgets($stream, 65536);
			if ($line === false) {
				$meta = stream_get_meta_data($stream);
				throw new \RuntimeException(!empty($meta['timed_out']) ? 'The server did not answer in time' : 'The server closed the connection');
			}
			$text = rtrim($line, "\r\n");
			if (str_starts_with($text, $tag . ' ')) {
				return [$text, $untagged];
			}
			$literals = [];
			while (preg_match('/\{(\d+)\}$/', $text, $m)) {
				$n = (int)$m[1];
				if ($n > $budget) {
					throw new \RuntimeException('The server sent more than this tool will read');
				}
				$budget -= $n;
				$literals[] = $this->readExactly($stream, $n);
				$text = substr($text, 0, -strlen($m[0])) . "\0";
				$more = @fgets($stream, 65536);
				if ($more === false) {
					throw new \RuntimeException('The server closed the connection');
				}
				$text .= rtrim($more, "\r\n");
			}
			$untagged[] = [$text, $literals];
		}
	}

	/** @param resource $stream */
	private function readExactly($stream, int $n): string {
		$data = '';
		while (strlen($data) < $n) {
			$chunk = @fread($stream, min(262144, $n - strlen($data)));
			if ($chunk === false || $chunk === '') {
				$meta = stream_get_meta_data($stream);
				if (!empty($meta['timed_out']) || feof($stream)) {
					throw new \RuntimeException('The server stopped in the middle of a message');
				}
				continue;
			}
			$data .= $chunk;
		}
		return $data;
	}

	/** A POP3 command answered on one line. */
	private function popLine($stream, string $command): string {
		@fwrite($stream, $command . self::CRLF);
		$line = @fgets($stream, 8192);
		return $line === false ? '' : rtrim($line, "\r\n");
	}

	private function popCount($stream): int {
		$reply = $this->popLine($stream, 'STAT');
		if (!preg_match('/^\+OK\s+(\d+)/', $reply, $m)) {
			throw new WordedRuntimeException('The server did not say how many messages there are: %s', [$reply]);
		}
		return (int)$m[1];
	}

	/** UIDL or LIST as number => value; an empty map where the server does not offer it. @return array<int, string> */
	private function popMap($stream, string $command): array {
		$body = $this->popMulti($stream, $command, 16777216);
		$out = [];
		if ($body === null) {
			return $out;
		}
		foreach (explode("\n", $body) as $line) {
			if (preg_match('/^(\d+)\s+(\S+)/', trim($line), $m)) {
				$out[(int)$m[1]] = $m[2];
			}
		}
		return $out;
	}

	/**
	 * A POP3 command answered with many lines, ending on a lone dot.
	 *
	 * A line of the message that starts with a dot is sent with a second one
	 * in front (RFC 1939 §3); that dot is taken off again here.
	 *
	 * @return ?string the lines after the +OK, or null for -ERR
	 */
	private function popMulti($stream, string $command, int $max): ?string {
		$first = $this->popLine($stream, $command);
		if (!str_starts_with($first, '+OK')) {
			if ($first === '') {
				throw new \RuntimeException('The server closed the connection');
			}
			return null;
		}
		$out = [];
		$size = 0;
		while (true) {
			$line = @fgets($stream, 65536);
			if ($line === false) {
				throw new \RuntimeException('The server stopped in the middle of a message');
			}
			$text = rtrim($line, "\r\n");
			if ($text === '.') {
				break;
			}
			if (str_starts_with($text, '..')) {
				$text = substr($text, 1);
			}
			$size += strlen($text) + 2;
			if ($size > $max) {
				throw new \RuntimeException('The server sent more than this tool will read');
			}
			$out[] = $text;
		}
		return implode("\r\n", $out);
	}

	/** @return list<array{name: string, address: string}> */
	private function addressList(array $headers, string $name): array {
		$out = [];
		foreach (self::addresses(implode(', ', $headers[$name] ?? [])) as $a) {
			$out[] = ['name' => MimeMessage::decodeHeader($a['name']), 'address' => $a['address']];
		}
		return $out;
	}

	/**
	 * The UIDs of the messages in the open folder whose subject, sender or
	 * recipient holds the words. Words that are not plain ASCII are sent as
	 * UTF-8 literals, which is how IMAP carries them.
	 *
	 * @param list<string> $caps
	 * @return list<int>
	 */
	private function imapSearch($stream, array $caps, string $term): array {
		$term = trim(str_replace(["\r", "\n", "\0"], ' ', $term));
		if (!preg_match('/[^\x20-\x7E]/', $term)) {
			$q = $this->imapQuote($term);
			[$status, $untagged] = $this->imapExchange($stream, 'q1', 'UID SEARCH OR OR SUBJECT ' . $q . ' FROM ' . $q . ' TO ' . $q);
		} else {
			$plus = in_array('LITERAL+', $caps, true);
			$lit = '{' . strlen($term) . ($plus ? '+' : '') . '}' . self::CRLF;
			@fwrite($stream, 'q1 UID SEARCH CHARSET UTF-8 OR OR SUBJECT ');
			foreach ([' FROM ', ' TO ', ''] as $next) {
				@fwrite($stream, $lit);
				if (!$plus) {
					$go = @fgets($stream, 65536);
					if ($go === false || !str_starts_with($go, '+')) {
						throw new \RuntimeException($this->l->t('The server refused to search: %s', [trim((string)$go)]));
					}
				}
				@fwrite($stream, $term . $next);
			}
			@fwrite($stream, self::CRLF);
			[$status, $untagged] = $this->imapRead($stream, 'q1');
		}
		if (!preg_match('/^q1 OK/i', $status)) {
			throw new \RuntimeException($this->l->t('The server refused to search: %s', [$status]));
		}
		$uids = [];
		foreach ($untagged as [$text]) {
			if (preg_match('/^\* SEARCH\s*(.*)$/i', $text, $m)) {
				foreach (preg_split('/\s+/', trim($m[1])) ?: [] as $u) {
					if (ctype_digit($u)) {
						$uids[] = (int)$u;
					}
				}
			}
		}
		return $uids;
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
			throw $errstr !== ''
				? new WordedRuntimeException('Could not connect to %1$s:%2$s (%3$s)', [$host, (string)$port, $errstr])
				: new WordedRuntimeException('Could not connect to %1$s:%2$s', [$host, (string)$port]);
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
		throw new WordedRuntimeException('Only %s offered; NetBase can use PLAIN or LOGIN', [implode(', ', $offered)]);
	}

	private function expect(string $reply, string $prefix, string $message = 'Unexpected reply'): void {
		$first = trim(strtok($reply, "\n") ?: '');
		if (!str_starts_with($first, $prefix)) {
			throw new WordedRuntimeException($message . ': %s', [$first]);
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
