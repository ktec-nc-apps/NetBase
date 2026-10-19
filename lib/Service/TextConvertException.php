<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/**
 * A conversion that was not done, and why, in a form the screen can word:
 * 'binary', 'too-large', 'not-valid' (the bytes are not that encoding) or
 * 'lost' (the target cannot hold some characters, which are listed).
 */
final class TextConvertException extends \RuntimeException {
	/**
	 * @param list<string> $args
	 * @param list<string> $lost
	 */
	public function __construct(public readonly string $reason, public readonly array $args = [], public readonly array $lost = []) {
		parent::__construct($reason);
	}
}
