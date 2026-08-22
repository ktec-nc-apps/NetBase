<?php

declare(strict_types=1);

namespace OCA\NetBase\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method string|null getUserId()
 * @method void setUserId(?string $userId)
 * @method string|null getName()
 * @method void setName(?string $name)
 * @method string|null getKind()
 * @method void setKind(?string $kind)
 * @method string|null getHost()
 * @method void setHost(?string $host)
 * @method int|null getPort()
 * @method void setPort(?int $port)
 * @method string|null getUsername()
 * @method void setUsername(?string $username)
 * @method string|null getSecret()
 * @method void setSecret(?string $secret)
 * @method string|null getOptions()
 * @method void setOptions(?string $options)
 * @method string|null getNotes()
 * @method void setNotes(?string $notes)
 * @method int|null getLastUsed()
 * @method void setLastUsed(?int $lastUsed)
 * @method string|null getLastResult()
 * @method void setLastResult(?string $lastResult)
 * @method int|null getCreated()
 * @method void setCreated(?int $created)
 * @method int|null getUpdated()
 * @method void setUpdated(?int $updated)
 */
class EndpointEntity extends Entity implements \JsonSerializable {
	protected $userId = null;
	protected $name = null;
	protected $kind = null;
	protected $host = null;
	protected $port = 0;
	protected $username = null;
	protected $secret = null;
	protected $options = null;
	protected $notes = null;
	protected $lastUsed = null;
	protected $lastResult = null;
	protected $created = null;
	protected $updated = null;

	public function __construct() {
		$this->addType('port', 'integer');
		$this->addType('lastUsed', 'integer');
		$this->addType('created', 'integer');
		$this->addType('updated', 'integer');
	}

	/** The stored password is never serialised — only the fact that one exists. */
	public function jsonSerialize(): array {
		return [
			'id' => $this->getId(),
			'name' => $this->name,
			'kind' => $this->kind,
			'host' => $this->host,
			'port' => (int)$this->port,
			'username' => $this->username,
			'hasSecret' => ($this->secret ?? '') !== '',
			'options' => $this->options ? (json_decode($this->options, true) ?: []) : [],
			'notes' => $this->notes,
			'lastUsed' => $this->lastUsed,
			'lastResult' => $this->lastResult,
			'created' => $this->created,
			'updated' => $this->updated,
		];
	}
}
