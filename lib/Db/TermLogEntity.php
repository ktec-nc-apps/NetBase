<?php

declare(strict_types=1);

namespace OCA\NetBase\Db;

use OCP\AppFramework\Db\Entity;

/**
 * One step of a terminal session: a line that was typed, and what came back
 * before the next line was.
 *
 * @method string|null getUserId()
 * @method void setUserId(string $userId)
 * @method string|null getTermSession()
 * @method void setTermSession(string $termSession)
 * @method string|null getKind()
 * @method void setKind(string $kind)
 * @method string|null getTarget()
 * @method void setTarget(string $target)
 * @method int|null getStep()
 * @method void setStep(int $step)
 * @method string|null getTyped()
 * @method void setTyped(string $typed)
 * @method string|null getSaid()
 * @method void setSaid(string $said)
 * @method int|null getCreated()
 * @method void setCreated(int $created)
 */
class TermLogEntity extends Entity implements \JsonSerializable {
	protected $userId;
	protected $termSession;
	protected $kind;
	protected $target;
	protected $step = 0;
	protected $typed;
	protected $said;
	protected $created = 0;

	public function __construct() {
		$this->addType('step', 'integer');
		$this->addType('created', 'integer');
	}

	public function jsonSerialize(): array {
		return [
			'id' => (int)$this->id,
			'session' => (string)$this->termSession,
			'kind' => (string)$this->kind,
			'target' => (string)$this->target,
			'step' => (int)$this->step,
			'typed' => (string)$this->typed,
			'said' => (string)$this->said,
			'created' => (int)$this->created,
		];
	}
}
