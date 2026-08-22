<?php

declare(strict_types=1);

namespace OCA\NetBase\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<ScanEntity> */
class ScanMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'netbase_scans', ScanEntity::class);
	}

	public function find(int $id): ?ScanEntity {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/** @return ScanEntity[] */
	public function recent(int $limit = 20): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->orderBy('id', 'DESC')->setMaxResults($limit);
		return $this->findEntities($qb);
	}

	/** Drop scan rows older than the retention window so the table stays small. */
	public function purgeOlderThan(int $timestamp): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->lt('started', $qb->createNamedParameter($timestamp, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}
}
