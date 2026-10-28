<?php
/**
 * Regression test: a refresh that reads only the ARP table must not take every
 * device beyond the server's subnets offline (GitHub issue #2, NetBase 0.9.5:
 * "The ARP table only" turned the 13 devices of 192.168.100.0/24 offline, and
 * "The whole network" brought them back).
 *
 * Those devices sit behind a router, so the neighbour table never lists them
 * and they are kept online by a TCP touch of the addresses on file. That touch
 * went through reachBeyond(), whose "every address answered" guard throws a
 * batch away when 16 or more addresses all answer — right for a sweep of a
 * range, where a proxy or firewall answering for everything is the only way
 * everything can answer, but wrong for a list of devices already known to
 * exist: there, all of them answering is just a healthy network. 23 on file,
 * 23 answered, 0 were taken.
 *
 * reachKnown() asks about the same addresses and also about a few unused
 * addresses in each /24. A proxy answers for those too; a healthy network does
 * not.
 *
 * Real sockets: Linux answers on all of 127.0.0.0/8, so listeners on chosen
 * 127.0.0.x addresses stand in for devices, and one listener on 0.0.0.0 stands
 * in for a proxy that answers for every address.
 *
 * Run it in an empty network namespace, because a server that listens on
 * 0.0.0.0 (any web server on 80/443) answers on every 127.0.0.x and would look
 * like the proxy this test builds on purpose:
 *   unshare -n sh -c 'ip link set lo up && php tests/known_devices_reach_test.php'
 */
$root = dirname(__DIR__);
require $root . '/lib/Service/DiscoveryService.php';

use OCA\NetBase\Service\DiscoveryService;

$fail = 0;
$check = static function (string $name, bool $ok) use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name\n";
	if (!$ok) {
		$fail++;
	}
};

// tcpSweep() and the two reach methods need none of the constructor's services.
$disc = (new ReflectionClass(DiscoveryService::class))->newInstanceWithoutConstructor();
$port = 8080; // one of REACH_PORTS

$devices = [];
for ($i = 10; $i < 33; $i++) {   // 23 devices, as in the report
	$devices[] = '127.0.0.' . $i;
}

// ---- a healthy network: each device answers on its own, nothing else does ----
$sockets = [];
foreach ($devices as $ip) {
	$s = @stream_socket_server("tcp://$ip:$port", $errno, $errstr);
	if ($s === false) {
		fwrite(STDERR, "cannot listen on $ip:$port ($errstr), is 8080 busy?\n");
		exit(2);
	}
	$sockets[] = $s;
}

$check('the sweep guard still drops 23 of 23 answering (the old path, kept for sweeps of a range)',
	$disc->reachBeyond($devices) === []);

$kept = $disc->reachKnown($devices);
$check('23 known devices, all answering, all kept', count($kept) === 23);
$check('each is kept with the port that answered', ($kept['127.0.0.10'] ?? []) === [$port]);
$check('no proxy is reported on a healthy network', ($disc->lastReach['middle'] ?? null) === []);

// a device that is off stays out
fclose(array_pop($sockets));
$kept = $disc->reachKnown($devices);
$check('a device that does not answer is left out', count($kept) === 22 && !isset($kept['127.0.0.32']));

// fewer than 16 known devices: kept as before
$few = array_slice($devices, 0, 5);
$check('a handful of known devices are kept', count($disc->reachKnown($few)) === 5);
foreach ($sockets as $s) {
	fclose($s);
}

// ---- a proxy that answers for every address ---------------------------------
$proxy = @stream_socket_server("tcp://0.0.0.0:$port", $errno, $errstr);
if ($proxy === false) {
	fwrite(STDERR, "cannot listen on 0.0.0.0:$port ($errstr)\n");
	exit(2);
}
$taken = $disc->reachKnown($devices);
$check('when unused addresses answer too, nothing in that /24 is taken', $taken === []);
$check('and the diagnosis says so', ($disc->lastReach['middle'] ?? []) === ['127.0.0']);
fclose($proxy);

// ---- which unused addresses are asked about ---------------------------------
$many = [];
for ($i = 1; $i < 250; $i++) {
	$many[] = '10.9.8.' . $i;
}
$pick = new ReflectionMethod($disc, 'canariesFor');
$pick->setAccessible(true);
$canaries = $pick->invoke($disc, array_merge(['10.1.1.5', '10.1.1.6'], $many));
$check('canaries are picked for each /24 that has known devices', array_keys($canaries) === ['10.1.1', '10.9.8']);
$check('three canaries each', count($canaries['10.1.1']) === 3 && count($canaries['10.9.8']) === 3);
$check('never one of the known addresses', array_diff($canaries['10.1.1'], ['10.1.1.5', '10.1.1.6']) === $canaries['10.1.1']);
$check('and never .0 or .255', !array_filter(array_merge(...array_values($canaries)), static fn ($c) => preg_match('/\.(0|255)$/', $c) === 1));

echo $fail === 0 ? "\nall passed\n" : "\n$fail failed\n";
exit($fail === 0 ? 0 : 1);
