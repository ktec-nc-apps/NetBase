<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/** Something given that cannot be used, said with the value in it (see Worded). */
final class WordedInvalidArgumentException extends \InvalidArgumentException implements Worded {
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
