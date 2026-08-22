<?php

declare(strict_types=1);

namespace OCA\NetBase\Command;

use OCA\NetBase\Service\ScanService;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

class Scan extends Command {
	public function __construct(
		private ScanService $scanService,
	) {
		parent::__construct();
	}

	protected function configure(): void {
		$this->setName('netbase:scan')
			->setDescription('Sweep the LAN and print every device found')
			->addOption('target', 't', InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, 'CIDR block to scan (repeatable; defaults to this server\'s networks)')
			->addOption('no-ports', null, InputOption::VALUE_NONE, 'Skip the TCP service check')
			->addOption('no-names', null, InputOption::VALUE_NONE, 'Skip NetBIOS and mDNS name lookups')
			->addOption('arp-only', null, InputOption::VALUE_NONE, 'Read the neighbour table without sweeping first')
			->addOption('rate', null, InputOption::VALUE_REQUIRED, 'Packets per second for the sweep')
			->addOption('gentle', null, InputOption::VALUE_NONE, 'Sweep more slowly, with a lower peak load on the neighbour table')
			->addOption('json', null, InputOption::VALUE_NONE, 'Print the result as JSON');
	}

	protected function execute(InputInterface $input, OutputInterface $output): int {
		$options = [
			'ports' => !$input->getOption('no-ports'),
			'names' => !$input->getOption('no-names'),
			'arpOnly' => (bool)$input->getOption('arp-only'),
			'pace' => $input->getOption('gentle') ? 'gentle' : 'fast',
		];
		if ($input->getOption('rate') !== null) {
			$options['rate'] = (int)$input->getOption('rate');
		}
		$scan = $this->scanService->start(null, (array)$input->getOption('target'), $options);

		$json = (bool)$input->getOption('json');
		$result = ['scan' => $scan->jsonSerialize(), 'devices' => []];
		$guard = 0;
		do {
			$result = $this->scanService->step((int)$scan->getId(), 3.0);
			if (!$json) {
				$output->write(sprintf("\r%-70s", sprintf(
					'[%3d%%] %s',
					$result['scan']['percent'],
					$result['scan']['message'] ?? $result['scan']['phase']
				)));
			}
		} while ($result['scan']['state'] === 'running' && $guard++ < 10000);

		if (!$json) {
			$output->writeln('');
		}
		$devices = array_values(array_filter($result['devices'], static fn ($d) => $d['online']));
		usort($devices, static fn ($a, $b) => strcmp(str_pad($a['ip'] ?? '', 15), str_pad($b['ip'] ?? '', 15)));

		if ($json) {
			$output->writeln((string)json_encode($devices, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
			return 0;
		}

		$output->writeln(sprintf("\n<info>%d devices</info>\n", count($devices)));
		$output->writeln(sprintf('%-16s %-18s %-22s %-10s %-24s %s', 'IP', 'MAC', 'NAME', 'TYPE', 'VENDOR', 'PORTS'));
		$output->writeln(str_repeat('-', 120));
		foreach ($devices as $device) {
			$vendor = $device['vendor'] === '__randomized__' ? '(randomized MAC)' : (string)$device['vendor'];
			$output->writeln(sprintf(
				'%-16s %-18s %-22s %-10s %-24s %s',
				$device['ip'] ?? '',
				$device['mac'] ?? '',
				mb_strimwidth((string)($device['hostname'] ?? $device['label'] ?? ''), 0, 22),
				(string)$device['type'],
				mb_strimwidth($vendor, 0, 24),
				implode(',', $device['ports'])
			));
		}
		return 0;
	}
}
