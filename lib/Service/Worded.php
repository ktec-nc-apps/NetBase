<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/**
 * An error written for the reader that carries a value: a host, a name, the
 * server's own reply.
 *
 * ApiController::say() translates an error by looking its message up, which
 * stops working once a value is glued into the sentence: "Sign-in refused: a3
 * NO …" is in no translation file, so a Japanese screen showed it in English.
 * These keep the sentence and its values apart; the sentence is looked up and
 * the values are put back into the translation.
 */
interface Worded {
	/** The English sentence, with %s or %1$s where the values go. */
	public function text(): string;

	/** @return list<string|int> */
	public function args(): array;
}
