<?php
/**
 * Regression test: reading a registry's answer, including JPRS's.
 *
 * Every .jp domain is answered by JPRS, which does not write `Label: value`
 * like most registries. It writes `[Label]` and then spaces — no colon — and
 * for an organisational domain (co.jp, ad.jp) it puts an index letter in
 * front: `a. [ドメイン名]`. The Japanese labels were in the patterns from the
 * start, but each demanded a colon that JPRS never sends, so a .jp domain came
 * back with no details at all while .com worked fine.
 *
 * The bodies below are what the registries actually sent on 2026-09-14, kept
 * verbatim so the test needs no network and cannot drift.
 *
 * Run: php tests/whois_jp_test.php   (NC_ROOT=/var/www/nextcloud by default)
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Service/ToolService.php';

use OCA\NetBase\Service\ToolService;

$tool = (new ReflectionClass(ToolService::class))->newInstanceWithoutConstructor();
$parse = new ReflectionMethod(ToolService::class, 'parseDomainWhois');
$parse->setAccessible(true);
/**
 * A whois server answers over a socket, and every line it sends ends with
 * CRLF. Sample text typed into a test file ends with LF alone, and a pattern
 * that is wrong about the carriage return passes here and fails in the world:
 * that is exactly what happened — a .jp lookup lost its name servers while
 * this test said all was well. So every body below is converted before use.
 */
$wire = static fn (string $body): string => str_replace("\n", "\r\n", str_replace("\r\n", "\n", $body));
$read = static fn (string $body): array => $parse->invoke($tool, $wire($body));

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
    echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  ($got)") . "\n";
    if (!$ok) { $fail++; }
};

// ---------------------------------------------------------------- .jp
$jp = <<<'BODY'
[ JPRS database provides information on network administration. Its use is    ]
[ restricted to network administration purposes.                             ]

Domain Information: [ドメイン情報]
[Domain Name]                   POPUP.JP
[登録者名]                      ケーテック
[Registrant]                    KTEC
[Name Server]                   hal.ns.cloudflare.com
[Name Server]                   stella.ns.cloudflare.com
[Signing Key]
[登録年月日]                    2001/10/15
[有効期限]                      2026/10/31
[状態]                          Active
[最終更新]                      2026/06/15 00:45:29 (JST)
BODY;

$check('the sample really is CRLF, as a socket would send it', str_contains($wire($jp), "\r\n"));
$f = $read($jp);
$check('a .jp domain is read at all', $f !== [], 'nothing came back');
$check('.jp registrant', ($f['registrant'] ?? '') === 'ケーテック', $f['registrant'] ?? '-');
$check('.jp created', ($f['created'] ?? '') === '2001/10/15', $f['created'] ?? '-');
$check('.jp expires', ($f['expires'] ?? '') === '2026/10/31', $f['expires'] ?? '-');
$check('.jp status', ($f['status'] ?? '') === 'Active', $f['status'] ?? '-');
$check('.jp updated', str_starts_with($f['updated'] ?? '', '2026/06/15'), $f['updated'] ?? '-');
$check('.jp name servers, both of them',
    ($f['nameservers'] ?? '') === 'hal.ns.cloudflare.com, stella.ns.cloudflare.com', $f['nameservers'] ?? '-');
$check('an empty label is left out', !array_key_exists('signingkey', $f));

// ------------------------------------------------------------- co.jp
$cojp = <<<'BODY'
Domain Information: [ドメイン情報]
a. [ドメイン名]                 JPRS.CO.JP
e. [そしきめい]                 かぶしきがいしゃにほんれじすとりさーびす
f. [組織名]                     株式会社日本レジストリサービス
g. [Organization]               Japan Registry Services Co.,Ltd.
k. [組織種別]                   株式会社
m. [登録担当者]                 SO42861JP
p. [ネームサーバ]               ns1.jprs.co.jp
p. [ネームサーバ]               ns2.jprs.co.jp
s. [署名鍵]                     63574 8 2 (
                                5D5518EC26E3D8EED9411BA2373A0B9D )
[状態]                          Connected (2027/01/31)
[ロック状態]                    AgentChangeLocked
[登録年月日]                    2001/01/22
[接続年月日]                    2001/01/24
[最終更新]                      2026/02/01 01:02:04 (JST)
BODY;

$c = $read($cojp);
$check('an index letter does not hide the label', $c !== [], 'nothing came back');
$check('co.jp organisation', ($c['registrant'] ?? '') === '株式会社日本レジストリサービス', $c['registrant'] ?? '-');
$check('co.jp created', ($c['created'] ?? '') === '2001/01/22', $c['created'] ?? '-');
$check('co.jp status', ($c['status'] ?? '') === 'Connected (2027/01/31)', $c['status'] ?? '-');
$check('co.jp expiry comes out of the status', ($c['expires'] ?? '') === '2027/01/31', $c['expires'] ?? '-');
$check('co.jp name servers', ($c['nameservers'] ?? '') === 'ns1.jprs.co.jp, ns2.jprs.co.jp', $c['nameservers'] ?? '-');
$check('the continuation of a key is not a name server', !str_contains($c['nameservers'] ?? '', '5D55'));

// A label JPRS sends with nothing after it must not become an empty field.
$empty = "a. [ドメイン名]                 NIC.AD.JP\n[登録年月日]\n[最終更新]                      2026/08/18 16:38:00 (JST)";
$e = $read($empty);
$check('an empty date is not reported as a date', !isset($e['created']), $e['created'] ?? '-');
$check('the line after it is still read', str_starts_with($e['updated'] ?? '', '2026/08/18'), $e['updated'] ?? '-');

// ---------------------------------------------------------------- gTLD
// The ordinary shape must go on working exactly as it did.
$com = <<<'BODY'
   Domain Name: EXAMPLE.COM
   Registrar: Example Registrar, Inc.
   Registrar Abuse Contact Email: abuse@example-registrar.com
   Updated Date: 2026-08-14T07:01:44Z
   Creation Date: 1995-08-14T04:00:00Z
   Registry Expiry Date: 2027-08-13T04:00:00Z
   Domain Status: clientTransferProhibited
   Registrant Organization: Example Inc.
   Name Server: A.IANA-SERVERS.NET
   Name Server: B.IANA-SERVERS.NET
BODY;

$g = $read($com);
$check('gTLD registrar still read', ($g['registrar'] ?? '') === 'Example Registrar, Inc.', $g['registrar'] ?? '-');
$check('gTLD created still read', str_starts_with($g['created'] ?? '', '1995-08-14'), $g['created'] ?? '-');
$check('gTLD expires still read', str_starts_with($g['expires'] ?? '', '2027-08-13'), $g['expires'] ?? '-');
$check('gTLD status still read', ($g['status'] ?? '') === 'clientTransferProhibited', $g['status'] ?? '-');
$check('gTLD registrant still read', ($g['registrant'] ?? '') === 'Example Inc.', $g['registrant'] ?? '-');
$check('gTLD abuse still read', ($g['abuse'] ?? '') === 'abuse@example-registrar.com', $g['abuse'] ?? '-');
$check('gTLD name servers still read',
    ($g['nameservers'] ?? '') === 'a.iana-servers.net, b.iana-servers.net', $g['nameservers'] ?? '-');

echo $fail === 0 ? "\nall good\n" : "\n$fail failed\n";
exit($fail === 0 ? 0 : 1);
