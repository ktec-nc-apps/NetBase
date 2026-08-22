<?php

declare(strict_types=1);

namespace OCA\NetBase\Command;

use OCA\NetBase\Db\DeviceMapper;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

class Devices extends Command {
	public function __construct(
		private DeviceMapper $devices,
	) {
		parent::__construct();
	}

	protected function configure(): void {
		$this->setName('netbase:devices')
			->setDescription('List the devices NetBase has recorded')
			->addOption('online', null, InputOption::VALUE_NONE, 'Only devices seen in the most recent sweep')
			->addOption('json', null, InputOption::VALUE_NONE, 'Print the result as JSON');
	}

	protected function execute(InputInterface $input, OutputInterface $output): int {
		$devices = array_map(static fn ($d) => $d->jsonSerialize(), $this->devices->findAll());
		if ($input->getOption('online')) {
			$devices = array_values(array_filter($devices, static fn ($d) => $d['online']));
		}
		if ($input->getOption('json')) {
			$output->writeln((string)json_encode($devices, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
			return 0;
		}
		$output->writeln(sprintf('%-16s %-18s %-24s %-10s %-8s %s', 'IP', 'MAC', 'NAME', 'TYPE', 'ONLINE', 'LAST SEEN'));
		$output->writeln(str_repeat('-', 110));
		foreach ($devices as $device) {
			$output->writeln(sprintf(
				'%-16s %-18s %-24s %-10s %-8s %s',
				$device['ip'] ?? '',
				$device['mac'] ?? '',
				mb_strimwidth((string)$device['name'], 0, 24),
				(string)$device['type'],
				$device['online'] ? 'yes' : 'no',
				$device['lastSeen'] ? date('Y-m-d H:i', (int)$device['lastSeen']) : ''
			));
		}
		return 0;
	}
}
