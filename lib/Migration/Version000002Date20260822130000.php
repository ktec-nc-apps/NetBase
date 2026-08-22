<?php

declare(strict_types=1);

namespace OCA\NetBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Saved connections: the FTP / SFTP / mail servers a user works with.
 *
 * The password lives in `secret`, encrypted with the instance secret through
 * ICrypto, and never leaves the server — the API only ever reports whether one
 * is stored. Columns stay nullable: a NOT NULL string column cannot take an
 * empty default on every database Nextcloud supports.
 */
class Version000002Date20260822130000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('netbase_endpoints')) {
			$table = $schema->createTable('netbase_endpoints');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'length' => 20]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => false, 'length' => 64]);
			$table->addColumn('name', Types::STRING, ['notnull' => false, 'length' => 128]);
			$table->addColumn('kind', Types::STRING, ['notnull' => false, 'length' => 16]);
			$table->addColumn('host', Types::STRING, ['notnull' => false, 'length' => 255]);
			$table->addColumn('port', Types::INTEGER, ['notnull' => false, 'default' => 0]);
			$table->addColumn('username', Types::STRING, ['notnull' => false, 'length' => 255]);
			$table->addColumn('secret', Types::TEXT, ['notnull' => false]);
			$table->addColumn('options', Types::TEXT, ['notnull' => false]);
			$table->addColumn('notes', Types::TEXT, ['notnull' => false]);
			$table->addColumn('last_used', Types::BIGINT, ['notnull' => false, 'length' => 20]);
			$table->addColumn('last_result', Types::STRING, ['notnull' => false, 'length' => 255]);
			$table->addColumn('created', Types::BIGINT, ['notnull' => false, 'length' => 20]);
			$table->addColumn('updated', Types::BIGINT, ['notnull' => false, 'length' => 20]);
			$table->setPrimaryKey(['id']);
			$table->addIndex(['user_id'], 'netbase_ep_user');
		}

		return $schema;
	}
}
