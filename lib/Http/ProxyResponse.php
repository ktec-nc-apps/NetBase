<?php

declare(strict_types=1);

namespace OCA\NetBase\Http;

use OCP\AppFramework\Http;
use OCP\AppFramework\Http\ICallbackResponse;
use OCP\AppFramework\Http\IOutput;
use OCP\AppFramework\Http\Response;

/**
 * A device's answer, handed on as it arrives.
 *
 * A page is small and has to be rewritten before the browser sees it, but a
 * firmware image, a configuration backup or a camera's picture stream is
 * neither small nor rewritable. Holding those in memory would cap what a
 * device window can carry; passing them straight through caps nothing, and a
 * stream that never ends — a camera — keeps working.
 */
class ProxyResponse extends Response implements ICallbackResponse {
	/** @var callable(IOutput): void */
	private $writer;

	/** @param callable(IOutput): void $writer */
	public function __construct(callable $writer) {
		parent::__construct();
		$this->writer = $writer;
		$this->setStatus(Http::STATUS_OK);
	}

	public function callback(IOutput $output): void {
		($this->writer)($output);
	}
}
