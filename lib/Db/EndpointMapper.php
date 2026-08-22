<?php

declare(strict_types=1);

namespace OCA\NetBase\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<EndpointEntity> */
class EndpointMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'netbase_endpoints', EndpointEntity::class);
	}

	/**
	 * Connections belong to the account that saved them. There is no shared
	 * pool: a stored password is one person's credential, not the instance's.
	 *
	 * @return EndpointEntity[]
	 */
	public function findForUser(string $userId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId, IQueryBuilder::PARAM_STR)))
			->orderBy('name', 'ASC')
			->setMaxResults(500);
		return $this->findEntities($qb);
	}

	public function findOwned(int $id, string $userId): ?EndpointEntity {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('user_id', $qb->createNamedParameter($userId, IQueryBuilder::PARAM_STR)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	public function deleteForUser(string $userId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId, IQueryBuilder::PARAM_STR)));
		$qb->executeStatement();
	}
}
