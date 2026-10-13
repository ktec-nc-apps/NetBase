<?php
/**
 * Wake-on-LAN: what is put into the administrator's command, and what is not.
 *
 * The command is the administrator's; the MAC and address come from the device
 * list or a request, so only a checked MAC (one fixed form) and an IPv4 address
 * may reach it — never a character a shell would act on. Also checks the relay
 * script recognises a magic packet and nothing else.
 *
 * Run: php tests/wake_test.php
 */
require __DIR__ . '/../lib/Service/WakeService.php';

use OCA\NetBase\Service\WakeService;

$fail = 0;
$check = static function (string $what, $got, $want) use (&$fail): void {
	if ($got !== $want) {
		$fail++;
		echo "FAIL $what: got " . var_export($got, true) . ', want ' . var_export($want, true) . "\n";
	}
};

// Forms people type, all to one.
// Space or a line end around it is trimmed; what comes out never carries it.
foreach (['AA:BB:CC:DD:EE:01', 'aa-bb-cc-dd-ee-01', 'aabb.ccdd.ee01', 'aabbccddee01', ' aa:bb:cc:dd:ee:01 ', "aa:bb:cc:dd:ee:01\n"] as $in) {
	$check("normalize $in", WakeService::normalizeMac($in), 'aa:bb:cc:dd:ee:01');
}
// Not a MAC, or not one a packet can be sent to.
foreach (['', 'aa:bb:cc:dd:ee', 'aa:bb:cc:dd:ee:0g', 'aa:bb-cc:dd:ee:01', '00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff',
	'aa:bb:cc:dd:ee:01; rm -rf /', '$(reboot)', "aa:bb:cc\n:dd:ee:01", 'aa:bb:cc:dd:ee:01:02'] as $in) {
	$check('refuse ' . json_encode($in), WakeService::normalizeMac($in), null);
}

$check('fill', WakeService::fill('wakeonlan -i {ip} {mac} # {MAC}', 'AA-BB-CC-DD-EE-01', '192.168.1.20'),
	'wakeonlan -i 192.168.1.20 aa:bb:cc:dd:ee:01 # AA:BB:CC:DD:EE:01');
// An address that is not IPv4 is left out rather than passed on.
$check('fill bad ip', WakeService::fill('x {ip}|', 'aa:bb:cc:dd:ee:01', '1.2.3.4;id'), 'x |');
$check('fill no ip', WakeService::fill('x {ip}|', 'aa:bb:cc:dd:ee:01', ''), 'x |');
try {
	WakeService::fill('x {mac}', 'aa:bb:cc:dd:ee:01;id', '');
	$check('fill bad mac throws', false, true);
} catch (\InvalidArgumentException $e) {
}

// The relay: a magic packet passes, anything else does not.
$relay = __DIR__ . '/../resources/wol-relay.py';
$py = 'import importlib.util,sys;s=importlib.util.spec_from_file_location("r",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
	. 'mac=bytes.fromhex("aabbccddee01");p=b"\xff"*6+mac*16;'
	. 'print(m.is_magic(p),m.is_magic(p+b"1234"),m.is_magic(p+b"123456"),m.is_magic(p[:-1]),m.is_magic(b"\x00"+p[1:]),m.is_magic(b"\xff"*6+b"\xff"*96),m.is_magic(b"\xff"*6+mac*15+bytes.fromhex("aabbccddee02")))';
$out = trim((string)shell_exec('python3 -I -B -c ' . escapeshellarg($py) . ' ' . escapeshellarg($relay)));
$check('relay is_magic', $out, 'True True True False False False False');

echo $fail === 0 ? "ok\n" : "$fail failed\n";
exit($fail === 0 ? 0 : 1);
