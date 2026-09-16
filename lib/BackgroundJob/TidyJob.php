<?php

declare(strict_types=1);

namespace OCA\NetBase\BackgroundJob;

use OCA\NetBase\Service\TermLogService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use Psr\Log\LoggerInterface;

/**
 * Drops the terminal sessions nobody asked to keep any longer.
 *
 * The limit is a number of days counted from a session's most recent step, so
 * this cannot be done as each step is written — a session only becomes old by
 * being left alone. Once a day is often enough for a limit measured in days.
 */
class TidyJob extends TimedJob {
	public function __construct(
		ITimeFactory $time,
		private TermLogService $log,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
		$this->setInterval(24 * 60 * 60);
		// Nothing here is time-sensitive: it may wait for the quiet hours.
		$this->setTimeSensitivity(self::TIME_INSENSITIVE);
	}

	protected function run($argument): void {
		try {
			$gone = $this->log->tidy();
		} catch (\Throwable $e) {
			$this->logger->warning('NetBase could not tidy the terminal log', ['exception' => $e, 'app' => 'netbase']);
			return;
		}
		if ($gone > 0) {
			$this->logger->debug('NetBase dropped ' . $gone . ' recorded terminal steps');
		}
	}
}
