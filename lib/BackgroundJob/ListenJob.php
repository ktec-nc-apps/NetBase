<?php

declare(strict_types=1);

namespace OCA\NetBase\BackgroundJob;

use OCA\NetBase\Service\ScanService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use Psr\Log\LoggerInterface;

/**
 * Keeps the list honest about devices that can only be heard.
 *
 * Anything on this wire that answers a question is found by a scan. A device
 * on a different network — a camera still on the address it left the factory
 * with — cannot answer, because its reply would go to a gateway it does not
 * have. It announces itself instead, once every three quarters of a minute,
 * and the only way to see it is to be listening at that moment. So this sits
 * on the multicast group for a minute at a time, on its own, and records what
 * it hears.
 */
class ListenJob extends TimedJob {
	/** Long enough to cover the announcement interval seen in the field. */
	private const LISTEN = 55.0;

	public function __construct(
		ITimeFactory $time,
		private ScanService $scans,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
		$this->setInterval(5 * 60);
		// Time-sensitive, and it has to be. This instance sets
		// maintenance_window_start, and an insensitive job then runs only
		// inside that four-hour window overnight — which for a job whose whole
		// purpose is to say what is on the wire right now means it never runs
		// when anyone is looking.
		$this->setTimeSensitivity(self::TIME_SENSITIVE);
	}

	protected function run($argument): void {
		try {
			$heard = $this->scans->listen(self::LISTEN);
		} catch (\Throwable $e) {
			$this->logger->warning('NetBase could not listen for announcements', ['exception' => $e]);
			return;
		}
		if ($heard !== []) {
			$this->logger->debug('NetBase heard ' . implode(', ', $heard));
		}
	}
}
