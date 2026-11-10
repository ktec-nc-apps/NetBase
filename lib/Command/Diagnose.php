<?php

declare(strict_types=1);

namespace OCA\NetBase\Command;

use OCA\NetBase\Service\DiagnoseService;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

class Diagnose extends Command {
	public function __construct(
		private DiagnoseService $diagnose,
	) {
		parent::__construct();
	}

	protected function configure(): void {
		$this->setName('netbase:diagnose')
			->setDescription('Report what this server runs in, which networks it sees and the state of the device records, for a problem report')
			->addOption('no-mask', null, InputOption::VALUE_NONE, 'Show MAC addresses and public addresses in full')
			->addOption('no-save', null, InputOption::VALUE_NONE, 'Do not keep the addresses seen now for the next report to compare with');
	}

	protected function execute(InputInterface $input, OutputInterface $output): int {
		$r = $this->diagnose->report(!$input->getOption('no-mask'), !$input->getOption('no-save'));
		$output->writeln($r['text'], OutputInterface::OUTPUT_RAW);
		return 0;
	}
}
