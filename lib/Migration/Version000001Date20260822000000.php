<?php

declare(strict_types=1);

namespace OCA\NetBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

class Version000001Date20260822000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('netbase_devices')) {
			$table = $schema->createTable('netbase_devices');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'length' => 20]);
			// Stable identity: the MAC when we have one, otherwise 'ip:<address>'.
			$table->addColumn('dkey', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('mac', Types::STRING, ['notnull' => false, 'length' => 32]);
			$table->addColumn('ip', Types::STRING, ['notnull' => false, 'length' => 45]);
			$table->addColumn('hostname', Types::STRING, ['notnull' => false, 'length' => 255]);
			$table->addColumn('label', Types::STRING, ['notnull' => false, 'length' => 255]);
			$table->addColumn('vendor', Types::STRING, ['notnull' => false, 'length' => 255]);
			$table->addColumn('dtype', Types::STRING, ['notnull' => false, 'length' => 32]);
			$table->addColumn('workgroup', Types::STRING, ['notnull' => false, 'length' => 64]);
			$table->addColumn('interface', Types::STRING, ['notnull' => false, 'length' => 32]);
			$table->addColumn('ports', Types::STRING, ['notnull' => false, 'length' => 512]);
			$table->addColumn('sources', Types::STRING, ['notnull' => false, 'length' => 255]);
			$table->addColumn('tags', Types::STRING, ['notnull' => false, 'length' => 255]);
			$table->addColumn('notes', Types::TEXT, ['notnull' => false]);
			$table->addColumn('extra', Types::TEXT, ['notnull' => false]);
			$table->addColumn('first_seen', Types::BIGINT, ['notnull' => false, 'length' => 20]);
			$table->addColumn('last_seen', Types::BIGINT, ['notnull' => false, 'length' => 20]);
			$table->addColumn('online', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$table->addColumn('known', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['dkey'], 'netbase_dev_key');
			$table->addIndex(['last_seen'], 'netbase_dev_seen');
		}

		if (!$schema->hasTable('netbase_scans')) {
			$table = $schema->createTable('netbase_scans');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'length' => 20]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => false, 'length' => 64]);
			$table->addColumn('targets', Types::TEXT, ['notnull' => false]);
			$table->addColumn('options', Types::TEXT, ['notnull' => false]);
			$table->addColumn('phase', Types::STRING, ['notnull' => false, 'length' => 16]);
			$table->addColumn('state', Types::STRING, ['notnull' => false, 'length' => 16]);
			$table->addColumn('cursor', Types::BIGINT, ['notnull' => false, 'length' => 20, 'default' => 0]);
			$table->addColumn('total', Types::BIGINT, ['notnull' => false, 'length' => 20, 'default' => 0]);
			$table->addColumn('found', Types::INTEGER, ['notnull' => false, 'default' => 0]);
			$table->addColumn('queue', Types::TEXT, ['notnull' => false]);
			$table->addColumn('message', Types::TEXT, ['notnull' => false]);
			$table->addColumn('started', Types::BIGINT, ['notnull' => false, 'length' => 20]);
			$table->addColumn('updated', Types::BIGINT, ['notnull' => false, 'length' => 20]);
			$table->addColumn('finished', Types::BIGINT, ['notnull' => false, 'length' => 20]);
			$table->setPrimaryKey(['id']);
			$table->addIndex(['user_id'], 'netbase_scan_user');
		}

		return $schema;
	}
}
