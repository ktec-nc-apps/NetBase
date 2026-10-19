<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/** A refusal or failure whose sentence carries values (see Worded). */
final class WordedRuntimeException extends \RuntimeException implements Worded {
	/** @param list<string|int> $args */
	public function __construct(private string $text, private array $args = []) {
		parent::__construct(vsprintf($text, $args));
	}

	public function text(): string {
		return $this->text;
	}

	public function args(): array {
		return $this->args;
	}
}
