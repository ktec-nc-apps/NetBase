<?php
/**
 * The environment report's pure parts: telling a container from a native
 * install, a host-network container from one on its own network, hiding
 * MACs and public addresses, and what changed between two reports.
 * Run: php tests/diagnose_test.php   (NC_ROOT=/var/www/nextcloud by default)
 */
$nc = getenv('NC_ROOT') ?: '/var/www/nextcloud';
require $nc . '/3rdparty/autoload.php';
require $nc . '/lib/composer/autoload.php';
require __DIR__ . '/../lib/Db/DeviceEntity.php';
require __DIR__ . '/../lib/Service/OuiService.php';
require __DIR__ . '/../lib/Service/ScanService.php';
require __DIR__ . '/../lib/Service/DiagnoseService.php';

use OCA\NetBase\Service\DiagnoseService as D;

$fail = 0;
$check = static function (string $name, bool $ok, string $got = '') use (&$fail): void {
	echo ($ok ? 'PASS' : 'FAIL') . "  $name" . ($ok ? '' : "  (got: $got)") . "\n";
	if (!$ok) { $fail++; }
};

$check('Docker: /.dockerenv', D::containerKind(true, false, '', '0::/') === 'Docker container');
$check('Podman: /run/.containerenv says podman', D::containerKind(false, true, "engine=\"podman-4.9.3\"\n", '') === 'Podman container');
$check('Docker by systemd scope', D::containerKind(false, false, '', "0::/system.slice/docker-3f2a9b8c7d6e5f4a.scope\n") === 'Docker container');
$check('Docker by cgroup v1', D::containerKind(false, false, '', "12:pids:/docker/3f2a\n") === 'Docker container');
$check('native: cgroup of systemd', D::containerKind(false, false, '', "0::/init.scope\n") === '', D::containerKind(false, false, '', "0::/init.scope\n"));
$check('native: a service called docker.service is not a container', D::containerKind(false, false, '', "0::/system.slice/docker.service\n") === '', D::containerKind(false, false, '', "0::/system.slice/docker.service\n"));

$check('own network: lo and eth0 only', D::looksLikeHostNetwork(['lo', 'eth0']) === false);
$check('own network: two networks', D::looksLikeHostNetwork(['lo', 'eth0', 'eth1']) === false);
$check('host network: docker0 and a real NIC visible', D::looksLikeHostNetwork(['lo', 'enp3s0', 'docker0']) === true);

$check('Podman: an empty /run/.containerenv (not privileged)', D::containerKind(false, true, '', '') === 'Podman container');
$check('another engine writing /run/.containerenv', D::containerKind(false, true, "engine=\"cri-o\"\n", '') === 'container (/run/.containerenv)');
$check('in a network', D::inAny('172.19.0.5', ['10.0.0.0/16', '172.19.0.0/16']) && !D::inAny('172.20.0.5', ['172.19.0.0/16']));
$check('Docker range 172.19.0.0/16', D::isContainerRange('172.19.0.0/16'));
$check('Podman range 10.88.0.0/16', D::isContainerRange('10.88.0.0/16'));
$check('a LAN is not a container range', !D::isContainerRange('192.168.88.0/24'));
$check('172.32 is outside 172.16/12', !D::isContainerRange('172.32.0.0/16'));

$check('MAC: vendor half stays', D::maskMac('92:3C:40:cc:e9:fe') === '92:3c:40:**:**:**', D::maskMac('92:3C:40:cc:e9:fe'));
$check('private address stays', D::maskIp('192.168.88.10') === '192.168.88.10');
$check('container address stays', D::maskIp('172.19.0.0/16') === '172.19.0.0/16');
$check('public address is hidden', D::maskIp('203.0.114.7') === '203.0.x.x', D::maskIp('203.0.114.7'));
$check('public network keeps its length', D::maskIp('8.8.4.0/24') === '8.8.x.x/24', D::maskIp('8.8.4.0/24'));

$check('NET_RAW only', D::capabilities("CapEff:\t0000000000002000\n") === ['net_admin' => false, 'net_raw' => true]);
$check('no capabilities (www-data)', D::capabilities("CapEff:\t0000000000000000\n") === ['net_admin' => false, 'net_raw' => false]);
$check('name servers', D::nameservers("# x\nnameserver 127.0.0.11\nnameserver 1.1.1.1\n") === ['127.0.0.11', '1.1.1.1']);

// GitHub #3: a restart gave every container a new MAC and shuffled some addresses.
$before = [
	'172.19.0.19' => ['mac' => 'de:7b:97:3d:2e:5a', 'name' => 'redis-node3.lg.net'],
	'172.19.0.5' => ['mac' => '02:00:00:00:00:05', 'name' => 'code-web.lg.net'],
	'172.19.0.9' => ['mac' => '02:00:00:00:00:09', 'name' => 'lg7p.lg.net'],
	'172.19.0.30' => ['mac' => '02:00:00:00:00:30', 'name' => ''],
];
$now = [
	'172.19.0.19' => ['mac' => '92:3c:40:cc:e9:fe', 'name' => 'redis-node3.lg.net'],
	'172.19.0.5' => ['mac' => '02:00:00:00:01:05', 'name' => 'lg7p.lg.net'],
	'172.19.0.9' => ['mac' => '02:00:00:00:01:09', 'name' => 'code-web.lg.net'],
	'172.19.0.30' => ['mac' => '02:00:00:00:00:30', 'name' => ''],
];
$c = D::compare($before, $now);
$check('restart: new MAC, same name', count($c['newMac']) === 1 && $c['newMac'][0]['ip'] === '172.19.0.19', json_encode($c['newMac']));
$check('shuffle: two addresses held by another name', count($c['otherName']) === 2, json_encode($c['otherName']));
$check('shuffle: two names moved', count($c['moved']) === 2 && in_array(['name' => 'lg7p.lg.net', 'was' => '172.19.0.9', 'now' => '172.19.0.5'], $c['moved'], true), json_encode($c['moved']));
$check('nothing changed: nothing reported', D::compare($now, $now) === ['newMac' => [], 'otherName' => [], 'moved' => []]);

echo $fail === 0 ? "\nall passed\n" : "\n$fail failed\n";
exit($fail === 0 ? 0 : 1);
