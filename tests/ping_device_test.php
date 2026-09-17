<?php
/**
 * The device list's "Ping this device", and the two things that keep it honest.
 *
 * 1. It never reaches off the local network. The endpoint takes a device id,
 *    not an address, so nothing can be aimed at it from outside the list; and
 *    the service puts the address through onLinkOnly() before a packet is sent,
 *    so an address on no subnet of this server is refused rather than pinged.
 *
 * 2. It sends the number of packets it was asked for. `ping` reads -c as "stop
 *    after this many replies", so with a -w deadline it keeps sending past the
 *    count against a silent device — asking for two sent four, and took twice
 *    as long. The deadline was removed for that reason; this fails if it comes
 *    back.
 *
 * Run: php tests/ping_device_test.php
 */
$root = dirname(__DIR__);

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  (got: $got)") . "\n";
	if (!$ok) {
		$fail++;
	}
};

// ---- the service ----------------------------------------------------------

$tool = (string)file_get_contents($root . '/lib/Service/ToolService.php');
$start = strpos($tool, 'public function pingDevice');
$check('ToolService has pingDevice()', $start !== false);
$body = $start === false ? '' : substr($tool, $start, 2600);

$check(
	'it refuses an address that is not on one of this server\'s subnets',
	str_contains($body, 'onLinkOnly('),
	'onLinkOnly is not called'
);
$guardAt = strpos($body, 'onLinkOnly(');
$runAt = strpos($body, '$this->exec->run(');
$check(
	'the check comes before anything is sent',
	$guardAt !== false && $runAt !== false && $guardAt < $runAt
);
$check(
	'only IPv4 literals are accepted (a name could resolve anywhere)',
	str_contains($body, 'FILTER_VALIDATE_IP') && str_contains($body, 'FILTER_FLAG_IPV4')
);

// The arguments handed to ping, as one string.
preg_match('/\$this->exec->run\(\s*\'ping\',\s*\[(.*?)\]/s', $body, $m);
$args = $m[1] ?? '';
$check('it runs ping with an argument list (no shell)', $args !== '');
$check("it passes -c, the packet count", str_contains($args, "'-c'"));
$check("it passes -n, so no name lookup is timed", str_contains($args, "'-n'"));
$check("it passes -W, the wait for one reply", str_contains($args, "'-W'"));
$check(
	"it does NOT pass -w: with a deadline, -c counts replies and overshoots",
	!str_contains($args, "'-w'"),
	trim($args)
);
$check('the count is clamped', str_contains($body, 'max(1, min(10, $count))'));

// ---- the endpoint ---------------------------------------------------------

$api = (string)file_get_contents($root . '/lib/Controller/ApiController.php');
$at = strpos($api, 'public function pingDevice');
$check('ApiController has pingDevice()', $at !== false);
$signature = $at === false ? '' : substr($api, $at, 200);
$check(
	'the endpoint takes a device id, never a host from the caller',
	str_contains($signature, 'pingDevice(int $id') && !str_contains($signature, 'string $host'),
	trim(strtok($signature, "\n"))
);
$call = $at === false ? '' : substr($api, $at, 900);
$check('it looks the address up from the row', str_contains($call, '$this->devices->find($id)'));
$check('it is guarded by the device-list permission', str_contains($call, "'devices'"));

// ---- the route ------------------------------------------------------------

$routes = (string)file_get_contents($root . '/appinfo/routes.php');
// The delimiter is ~ here on purpose: the pattern contains a # of its own,
// in 'api#pingDevice'.
$check(
	'the route is POST /api/devices/{id}/ping',
	(bool)preg_match("~'api\#pingDevice'.*'/api/devices/\{id\}/ping'.*'POST'~", $routes),
	'no such route line'
);

// ---- the interface --------------------------------------------------------

$js = (string)file_get_contents($root . '/js/netbase.js');
$check('the row menu offers it', str_contains($js, 'pingDevice(rowMenu.device)'));
$check('the menu entry is hidden for a row with no address', str_contains($js, 'v-if="rowMenu.device && rowMenu.device.ip"'));
$check('the browser sends the id, not an address', str_contains($js, "api('devices/' + d.id + '/ping'"));

// A machine with a foot in several networks is one row per address. The row
// menu hands over whichever row carries the name, which on this server was the
// container bridge (10.88.0.1) rather than the address anyone means (10.0.0.1).
// The address is therefore chosen on its own merits before anything is sent.
$at = strpos($js, 'pingTarget(device) {');
$pick = $at === false ? '' : substr($js, $at, 1800);
$check('there is a chooser for which address to ping', $at !== false);
$check('it uses the ping target rather than the row it was handed', str_contains($js, 'const d = this.pingTarget(device);'));
$check('it looks at every address of the same device', str_contains($pick, 'g.members.some('));
$check('a routed network wins', str_contains($pick, 'this.netRank(m)'));
$check('an address this server has no interface on is never chosen', str_contains($pick, 'rank(m) < 999'));
$check('ties fall to the lowest address, so the choice is stable', str_contains($pick, 'value(a.ip) - value(b.ip)'));

// The row menu is the only way in. A second button in the device panel was
// tried and taken out again: the menu already reaches every row, and the panel
// is for what a device is rather than for asking it questions.
$check('there is no second button in the device panel', !str_contains($js, 'pingDevice(selected)'));

// ---- translations ---------------------------------------------------------

$keys = [
	'Ping this device',
	'Again',
	'Waiting for a reply…',
	'%s is not on a network this server is connected to, so it cannot be pinged from here.',
	'The ping command is not installed on this server, so reachability cannot be tested this way.',
];
$langs = ['ar', 'cs', 'de', 'en', 'es', 'fa', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'th', 'tr', 'uk', 'vi', 'zh'];
$short = [];
foreach ($langs as $lang) {
	$json = json_decode((string)file_get_contents($root . '/l10n/' . $lang . '.json'), true)['translations'] ?? [];
	$raw = (string)file_get_contents($root . '/l10n/' . $lang . '.js');
	$open = strpos($raw, '{');
	$close = strrpos($raw, '}');
	$plain = json_decode(substr($raw, $open, $close - $open + 1), true) ?: [];
	foreach ($keys as $key) {
		if (!isset($json[$key]) || !isset($plain[$key])) {
			$short[] = $lang . ':' . substr($key, 0, 20);
			continue;
		}
		// A %s dropped in translation breaks the string at runtime.
		if (substr_count($key, '%s') !== substr_count($json[$key], '%s')) {
			$short[] = $lang . ':%s:' . substr($key, 0, 20);
		}
	}
	if ($json !== $plain) {
		$short[] = $lang . ':json and js differ';
	}
}
$check('all five strings are in all twenty languages, .json and .js alike', $short === [], implode(', ', array_slice($short, 0, 4)));

// ---- syntax ---------------------------------------------------------------

foreach (['lib/Service/ToolService.php', 'lib/Controller/ApiController.php', 'appinfo/routes.php'] as $file) {
	$lint = shell_exec('php -l ' . escapeshellarg($root . '/' . $file) . ' 2>&1');
	$check("$file lints clean", str_contains((string)$lint, 'No syntax errors'));
}

echo $fail === 0 ? "\nALL PASS\n" : "\n$fail FAILED\n";
exit($fail === 0 ? 0 : 1);
