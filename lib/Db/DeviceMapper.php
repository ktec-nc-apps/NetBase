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

	/** Every row currently holding an address — normally one, but used to find
	 *  and clear duplicates left by a device whose MAC changes (a privacy
	 *  address rotates), which would otherwise show the same IP twice. */
	public function findAllByIp(string $ip): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('ip', $qb->createNamedParameter($ip, IQueryBuilder::PARAM_STR)))
			->orderBy('mac', 'DESC')
			->addOrderBy('last_seen', 'DESC');
		return $this->findEntities($qb);
	}

	/** Addresses that appear on more than one row — duplicates to fold together. */
	public function duplicateIps(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('ip')->from($this->getTableName())
			->where($qb->expr()->isNotNull('ip'))
			->groupBy('ip')
			->having($qb->expr()->gt($qb->func()->count('*'), $qb->createNamedParameter(1, IQueryBuilder::PARAM_INT)));
		$res = $qb->executeQuery();
		$ips = [];
		while ($row = $res->fetch()) {
			if (($row['ip'] ?? '') !== '') {
				$ips[] = (string)$row['ip'];
			}
		}
		$res->closeCursor();
		return $ips;
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

	/**
	 * Mark the given addresses online and seen now — the result of a liveness
	 * probe. Done in one statement so confirming dozens of devices is one write.
	 *
	 * @param list<string> $ips
	 */
	public function markOnline(array $ips): void {
		$ips = array_values(array_filter(array_unique($ips)));
		if ($ips === []) {
			return;
		}
		$now = time();
		foreach (array_chunk($ips, 500) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->update($this->getTableName())
				->set('online', $qb->createNamedParameter(true, IQueryBuilder::PARAM_BOOL))
				->set('last_seen', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT))
				->where($qb->expr()->in('ip', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_STR_ARRAY)));
			$qb->executeStatement();
		}
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
