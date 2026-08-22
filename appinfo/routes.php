<?php

declare(strict_types=1);

return [
	'routes' => [
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],

		// status & settings
		['name' => 'api#status', 'url' => '/api/status', 'verb' => 'GET'],
		['name' => 'api#getSettings', 'url' => '/api/settings', 'verb' => 'GET'],
		['name' => 'api#setSettings', 'url' => '/api/settings', 'verb' => 'POST'],

		// device inventory
		['name' => 'api#devices', 'url' => '/api/devices', 'verb' => 'GET'],
		['name' => 'api#updateDevice', 'url' => '/api/devices/{id}', 'verb' => 'PATCH'],
		['name' => 'api#deleteDevice', 'url' => '/api/devices/{id}', 'verb' => 'DELETE'],

		// scanning
		['name' => 'api#scanAdvice', 'url' => '/api/scan/advice', 'verb' => 'GET'],
		['name' => 'api#scanStart', 'url' => '/api/scan', 'verb' => 'POST'],
		['name' => 'api#scanStep', 'url' => '/api/scan/{id}/step', 'verb' => 'POST'],
		['name' => 'api#scanCancel', 'url' => '/api/scan/{id}', 'verb' => 'DELETE'],
		['name' => 'api#scanHistory', 'url' => '/api/scans', 'verb' => 'GET'],

		// tools
		['name' => 'api#whois', 'url' => '/api/tools/whois', 'verb' => 'GET'],
		['name' => 'api#dns', 'url' => '/api/tools/dns', 'verb' => 'GET'],
		['name' => 'api#reverse', 'url' => '/api/tools/reverse', 'verb' => 'GET'],
		['name' => 'api#ping', 'url' => '/api/tools/ping', 'verb' => 'GET'],
		['name' => 'api#traceroute', 'url' => '/api/tools/traceroute', 'verb' => 'GET'],
		['name' => 'api#ports', 'url' => '/api/tools/ports', 'verb' => 'GET'],
		['name' => 'api#tls', 'url' => '/api/tools/tls', 'verb' => 'GET'],
		['name' => 'api#http', 'url' => '/api/tools/http', 'verb' => 'GET'],
		['name' => 'api#subnet', 'url' => '/api/tools/subnet', 'verb' => 'GET'],
		['name' => 'api#macLookup', 'url' => '/api/tools/mac', 'verb' => 'GET'],
		['name' => 'api#wol', 'url' => '/api/tools/wol', 'verb' => 'POST'],
		['name' => 'api#serverInfo', 'url' => '/api/tools/server', 'verb' => 'GET'],

		// benchmarks
		['name' => 'api#counters', 'url' => '/api/bench/counters', 'verb' => 'GET'],
		['name' => 'api#speedTest', 'url' => '/api/bench/speedtest', 'verb' => 'POST'],
		['name' => 'api#dnsBenchmark', 'url' => '/api/bench/dns', 'verb' => 'GET'],
		['name' => 'api#httpTiming', 'url' => '/api/bench/http', 'verb' => 'GET'],
		['name' => 'api#iperf', 'url' => '/api/bench/iperf', 'verb' => 'POST'],
		['name' => 'api#pathQuality', 'url' => '/api/tools/path', 'verb' => 'GET'],

		// requirements
		['name' => 'api#requirements', 'url' => '/api/requirements', 'verb' => 'GET'],

		// saved connections (FTP / SFTP / mail accounts)
		['name' => 'api#connections', 'url' => '/api/connections', 'verb' => 'GET'],
		['name' => 'api#saveConnection', 'url' => '/api/connections', 'verb' => 'POST'],
		['name' => 'api#updateConnection', 'url' => '/api/connections/{id}', 'verb' => 'PUT'],
		['name' => 'api#deleteConnection', 'url' => '/api/connections/{id}', 'verb' => 'DELETE'],
		['name' => 'api#testConnection', 'url' => '/api/connections/{id}/test', 'verb' => 'POST'],

		// file transfer
		['name' => 'api#filesList', 'url' => '/api/files/list', 'verb' => 'GET'],
		['name' => 'api#filesDownload', 'url' => '/api/files/download', 'verb' => 'POST'],
		['name' => 'api#filesUpload', 'url' => '/api/files/upload', 'verb' => 'POST'],
		['name' => 'api#filesManage', 'url' => '/api/files/manage', 'verb' => 'POST'],

		// mail
		['name' => 'api#mailAudit', 'url' => '/api/mail/audit', 'verb' => 'GET'],
		['name' => 'api#mailProbe', 'url' => '/api/mail/probe', 'verb' => 'GET'],
		['name' => 'api#mailBlocklist', 'url' => '/api/mail/blocklist', 'verb' => 'GET'],
		['name' => 'api#mailRelayTest', 'url' => '/api/mail/relay', 'verb' => 'POST'],
		['name' => 'api#mailSend', 'url' => '/api/mail/send', 'verb' => 'POST'],

		// service probes
		['name' => 'api#probeSsh', 'url' => '/api/probe/ssh', 'verb' => 'GET'],
		['name' => 'api#probeTelnet', 'url' => '/api/probe/telnet', 'verb' => 'GET'],
		['name' => 'api#probeNtp', 'url' => '/api/probe/ntp', 'verb' => 'GET'],

		// nmap
		['name' => 'api#nmapScan', 'url' => '/api/nmap', 'verb' => 'POST'],
	],
];
