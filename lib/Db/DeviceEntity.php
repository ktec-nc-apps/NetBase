<?php

declare(strict_types=1);

namespace OCA\NetBase\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method string getDkey()
 * @method void setDkey(string $dkey)
 * @method string|null getMac()
 * @method void setMac(?string $mac)
 * @method string|null getIp()
 * @method void setIp(?string $ip)
 * @method string|null getHostname()
 * @method void setHostname(?string $hostname)
 * @method string|null getLabel()
 * @method void setLabel(?string $label)
 * @method string|null getVendor()
 * @method void setVendor(?string $vendor)
 * @method string|null getDtype()
 * @method void setDtype(?string $dtype)
 * @method string|null getWorkgroup()
 * @method void setWorkgroup(?string $workgroup)
 * @method string|null getInterface()
 * @method void setInterface(?string $interface)
 * @method string|null getPorts()
 * @method void setPorts(?string $ports)
 * @method string|null getSources()
 * @method void setSources(?string $sources)
 * @method string|null getTags()
 * @method void setTags(?string $tags)
 * @method string|null getNotes()
 * @method void setNotes(?string $notes)
 * @method string|null getExtra()
 * @method void setExtra(?string $extra)
 * @method int|null getFirstSeen()
 * @method void setFirstSeen(?int $firstSeen)
 * @method int|null getLastSeen()
 * @method void setLastSeen(?int $lastSeen)
 * @method bool|null getOnline()
 * @method void setOnline(?bool $online)
 * @method bool|null getKnown()
 * @method void setKnown(?bool $known)
 */
class DeviceEntity extends Entity implements \JsonSerializable {
	protected $dkey = '';
	protected $mac = null;
	protected $ip = null;
	protected $hostname = null;
	protected $label = null;
	protected $vendor = null;
	protected $dtype = null;
	protected $workgroup = null;
	protected $interface = null;
	protected $ports = null;
	protected $sources = null;
	protected $tags = null;
	protected $notes = null;
	protected $extra = null;
	protected $firstSeen = null;
	protected $lastSeen = null;
	protected $online = false;
	protected $known = false;

	public function __construct() {
		$this->addType('firstSeen', 'integer');
		$this->addType('lastSeen', 'integer');
		$this->addType('online', 'boolean');
		$this->addType('known', 'boolean');
	}

	public function jsonSerialize(): array {
		return [
			'id' => $this->getId(),
			'key' => $this->dkey,
			'mac' => $this->mac,
			'ip' => $this->ip,
			'hostname' => $this->hostname,
			'label' => $this->label,
			'name' => $this->label ?: ($this->hostname ?: ($this->ip ?? '')),
			'vendor' => $this->vendor,
			'type' => $this->dtype,
			'workgroup' => $this->workgroup,
			'interface' => $this->interface,
			'ports' => $this->ports ? array_map('intval', explode(',', $this->ports)) : [],
			'sources' => $this->sources ? explode(',', $this->sources) : [],
			'tags' => $this->tags ? explode(',', $this->tags) : [],
			'notes' => $this->notes,
			'extra' => $this->extra ? json_decode($this->extra, true) : null,
			'firstSeen' => $this->firstSeen,
			'lastSeen' => $this->lastSeen,
			'online' => (bool)$this->online,
			'known' => (bool)$this->known,
		];
	}
}
