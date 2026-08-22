<?php

declare(strict_types=1);

namespace OCA\NetBase\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method string|null getUserId()
 * @method void setUserId(?string $userId)
 * @method string|null getTargets()
 * @method void setTargets(?string $targets)
 * @method string|null getOptions()
 * @method void setOptions(?string $options)
 * @method string|null getPhase()
 * @method void setPhase(?string $phase)
 * @method string|null getState()
 * @method void setState(?string $state)
 * @method int|null getCursor()
 * @method void setCursor(?int $cursor)
 * @method int|null getTotal()
 * @method void setTotal(?int $total)
 * @method int|null getFound()
 * @method void setFound(?int $found)
 * @method string|null getQueue()
 * @method void setQueue(?string $queue)
 * @method string|null getMessage()
 * @method void setMessage(?string $message)
 * @method int|null getStarted()
 * @method void setStarted(?int $started)
 * @method int|null getUpdated()
 * @method void setUpdated(?int $updated)
 * @method int|null getFinished()
 * @method void setFinished(?int $finished)
 */
class ScanEntity extends Entity implements \JsonSerializable {
	protected $userId = null;
	protected $targets = null;
	protected $options = null;
	protected $phase = null;
	protected $state = null;
	protected $cursor = 0;
	protected $total = 0;
	protected $found = 0;
	protected $queue = null;
	protected $message = null;
	protected $started = null;
	protected $updated = null;
	protected $finished = null;

	public function __construct() {
		$this->addType('cursor', 'integer');
		$this->addType('total', 'integer');
		$this->addType('found', 'integer');
		$this->addType('started', 'integer');
		$this->addType('updated', 'integer');
		$this->addType('finished', 'integer');
	}

	/** Progress is stored structured so the browser can translate it. */
	public static function renderMessage(?array $progress): string {
		if ($progress === null) {
			return '';
		}
		$done = (int)($progress['done'] ?? 0);
		$total = (int)($progress['total'] ?? 0);
		return match ($progress['key'] ?? '') {
			'sweep' => sprintf('%d / %d addresses swept', $done, $total),
			'names' => sprintf('Asking devices for their names (%d / %d)', $done, $total),
			'names2' => sprintf('Asking again, more slowly (%d / %d)', $done, $total),
			'mcast' => 'Multicast discovery complete',
			'ports' => sprintf('Checking services (%d / %d)', $done, $total),
			'rdns' => sprintf('Reverse DNS (%d / %d)', $done, $total),
			default => (string)($progress['key'] ?? ''),
		};
	}

	public function jsonSerialize(): array {
		$total = max(1, (int)$this->total);
		$progress = $this->message !== null ? json_decode((string)$this->message, true) : null;
		if (!is_array($progress)) {
			$progress = null;
		}
		return [
			'id' => $this->getId(),
			'targets' => $this->targets ? json_decode($this->targets, true) : [],
			'phase' => $this->phase,
			'state' => $this->state,
			'cursor' => (int)$this->cursor,
			'total' => (int)$this->total,
			'found' => (int)$this->found,
			'percent' => min(100, (int)round((int)$this->cursor / $total * 100)),
			'progress' => $progress,
			'message' => $progress !== null ? self::renderMessage($progress) : $this->message,
			'started' => $this->started,
			'updated' => $this->updated,
			'finished' => $this->finished,
		];
	}
}
