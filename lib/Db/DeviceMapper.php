<?php

declare(strict_types=1);

namespace OCA\NetBase\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<DeviceEntity> */
class DeviceMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'netbase_devices', DeviceEntity::class);
	}

	/** @return DeviceEntity[] */
	public function findAll(int $limit = 5000): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->orderBy('last_seen', 'DESC')
			->setMaxResults($limit);
		return $this->findEntities($qb);
	}

	public function findByKey(string $key): ?DeviceEntity {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('dkey', $qb->createNamedParameter($key, IQueryBuilder::PARAM_STR)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/**
	 * The device currently holding an address. A row keyed by MAC wins over a
	 * placeholder row keyed by IP, so later phases attach to the real device.
	 */
	public function findByIp(string $ip): ?DeviceEntity {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('ip', $qb->createNamedParameter($ip, IQueryBuilder::PARAM_STR)))
			->orderBy('mac', 'DESC')
			->addOrderBy('last_seen', 'DESC')
			->setMaxResults(1);
		$rows = $this->findEntities($qb);
		return $rows[0] ?? null;
	}

	public function find(int $id): ?DeviceEntity {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/**
	 * Devices that only ever announce themselves, heard recently enough to
	 * still be here.
	 *
	 * A device on another network sharing this wire cannot be asked anything —
	 * its answer would go to a gateway it does not have — so the only proof it
	 * is present is its own announcement, which may be half a minute apart. A
	 * scan that happens to fall between two of them has learnt nothing about
	 * whether it is still there, and should not say it has gone.
	 */
	public function keepRecentlyHeard(int $since): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('online', $qb->createNamedParameter(true, IQueryBuilder::PARAM_BOOL))
			->where($qb->expr()->gte('last_seen', $qb->createNamedParameter($since, IQueryBuilder::PARAM_INT)))
			// Never in the ARP table means never reachable from here.
			->andWhere($qb->expr()->notLike('sources', $qb->createNamedParameter('%arp%')));
		$qb->executeStatement();
	}

	/** Mark every device as offline before a fresh sweep records what answers. */
	public function markAllOffline(): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('online', $qb->createNamedParameter(false, IQueryBuilder::PARAM_BOOL));
		$qb->executeStatement();
	}

	public function deleteById(int $id): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}
}
