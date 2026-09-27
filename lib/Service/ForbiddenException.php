<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

/** The account may not use this: answered 403. Other refusals are 400 (review C2, A3). */
class ForbiddenException extends \RuntimeException {
}
