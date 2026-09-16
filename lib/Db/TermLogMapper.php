<?php

declare(strict_types=1);

namespace OCA\NetBase\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<TermLogEntity> */
class TermLogMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'netbase_termlog', TermLogEntity::class);
	}

	/**
	 * The sessions one account has recorded, newest first: one row apiece,
	 * with when it started, when it last had anything to say, and how many
	 * steps are being kept.
	 *
	 * @return list<array{session: string, kind: string, target: string, steps: int, first: int, last: int}>
	 */
	public function sessions(string $userId, int $limit = 200): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('term_session', 'kind', 'target')
			->selectAlias($qb->createFunction('COUNT(*)'), 'steps')
			->selectAlias($qb->createFunction('MIN(' . $qb->getColumnName('created') . ')'), 'first')
			->selectAlias($qb->createFunction('MAX(' . $qb->getColumnName('created') . ')'), 'last')
			->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId, IQueryBuilder::PARAM_STR)))
			->groupBy('term_session', 'kind', 'target')
			->orderBy('last', 'DESC')
			->setMaxResults($limit);
		$out = [];
		$result = $qb->executeQuery();
		foreach ($result->fetchAll() as $row) {
			$out[] = [
				'session' => (string)$row['term_session'],
				'kind' => (string)$row['kind'],
				'target' => (string)$row['target'],
				'steps' => (int)$row['steps'],
				'first' => (int)$row['first'],
				'last' => (int)$row['last'],
			];
		}
		$result->closeCursor();
		return $out;
	}

	/**
	 * Every step of one session, in the order it happened.
	 *
	 * @return TermLogEntity[]
	 */
	public function steps(string $userId, string $session): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId, IQueryBuilder::PARAM_STR)))
			->andWhere($qb->expr()->eq('term_session', $qb->createNamedParameter($session, IQueryBuilder::PARAM_STR)))
			->orderBy('step', 'ASC')
			->setMaxResults(5000);
		return $this->findEntities($qb);
	}

	/** Throw one session away. Returns how many steps went with it. */
	public function dropSession(string $userId, string $session): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId, IQueryBuilder::PARAM_STR)))
			->andWhere($qb->expr()->eq('term_session', $qb->createNamedParameter($session, IQueryBuilder::PARAM_STR)));
		return $qb->executeStatement();
	}

	/** Throw away everything this account has recorded. */
	public function dropForUser(string $userId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId, IQueryBuilder::PARAM_STR)));
		return $qb->executeStatement();
	}

	/**
	 * Keep only the newest $keep steps of one session.
	 *
	 * The limit is a number of steps, not of bytes, so it is applied by step
	 * number: anything at or below the cut is gone.
	 */
	public function trim(string $userId, string $session, int $keep): int {
		if ($keep < 1) {
			return 0;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('step')->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId, IQueryBuilder::PARAM_STR)))
			->andWhere($qb->expr()->eq('term_session', $qb->createNamedParameter($session, IQueryBuilder::PARAM_STR)))
			->orderBy('step', 'DESC')
			->setFirstResult($keep)
			->setMaxResults(1);
		$result = $qb->executeQuery();
		$row = $result->fetch();
		$result->closeCursor();
		if ($row === false) {
			return 0;
		}
		$cut = (int)$row['step'];
		$del = $this->db->getQueryBuilder();
		$del->delete($this->getTableName())
			->where($del->expr()->eq('user_id', $del->createNamedParameter($userId, IQueryBuilder::PARAM_STR)))
			->andWhere($del->expr()->eq('term_session', $del->createNamedParameter($session, IQueryBuilder::PARAM_STR)))
			->andWhere($del->expr()->lte('step', $del->createNamedParameter($cut, IQueryBuilder::PARAM_INT)));
		return $del->executeStatement();
	}

	/**
	 * Every recorded session and when it was last written to — what the tidying
	 * job needs to decide which ones have gone quiet long enough to drop.
	 *
	 * @return list<array{user: string, session: string, last: int}>
	 */
	public function lastWritten(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('user_id', 'term_session')
			->selectAlias($qb->createFunction('MAX(' . $qb->getColumnName('created') . ')'), 'last')
			->from($this->getTableName())
			->groupBy('user_id', 'term_session')
			->setMaxResults(10000);
		$out = [];
		$result = $qb->executeQuery();
		foreach ($result->fetchAll() as $row) {
			$out[] = [
				'user' => (string)$row['user_id'],
				'session' => (string)$row['term_session'],
				'last' => (int)$row['last'],
			];
		}
		$result->closeCursor();
		return $out;
	}
}
