<?php

declare(strict_types=1);

namespace OCA\NetBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * What was done in a terminal, kept for as long as it is wanted.
 *
 * A shell on the server and an SSH window are the two places in NetBase where
 * something is done rather than merely looked at, and afterwards there is
 * usually no way to say what that was. A row here is one step: what was typed
 * on one line, and what came back before the next line was typed.
 *
 * Nothing is written unless somebody turns it on — the number of steps to keep
 * starts at zero, which means keep none. Two limits then hold the table down:
 * that number of steps per session, and a number of days counted from a
 * session's most recent step, after which the whole session goes.
 *
 * Columns stay nullable: a NOT NULL string column cannot take an empty default
 * on every database Nextcloud supports.
 */
class Version000003Date20260913000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('netbase_termlog')) {
			$table = $schema->createTable('netbase_termlog');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'length' => 20]);
			$table->addColumn('user_id', Types::STRING, ['notnull' => false, 'length' => 64]);
			// The one terminal window this step belongs to. Not called
			// `session`: that is a keyword on more than one of the databases
			// Nextcloud supports, and a column name is not worth the argument.
			$table->addColumn('term_session', Types::STRING, ['notnull' => false, 'length' => 64]);
			// 'shell' for this server, 'ssh' for a machine reached over SSH.
			$table->addColumn('kind', Types::STRING, ['notnull' => false, 'length' => 16]);
			// Where it happened: a host for SSH, the instance itself for a shell.
			$table->addColumn('target', Types::STRING, ['notnull' => false, 'length' => 255]);
			// 1, 2, 3 … within the session, so the order survives any sorting.
			$table->addColumn('step', Types::INTEGER, ['notnull' => false, 'default' => 0]);
			$table->addColumn('typed', Types::TEXT, ['notnull' => false]);
			$table->addColumn('said', Types::TEXT, ['notnull' => false]);
			$table->addColumn('created', Types::BIGINT, ['notnull' => false, 'length' => 20]);
			$table->setPrimaryKey(['id']);
			// Reading back one window, and finding the sessions that have gone
			// quiet long enough to be dropped.
			$table->addIndex(['user_id', 'term_session'], 'netbase_tl_sess');
			$table->addIndex(['created'], 'netbase_tl_time');
		}

		return $schema;
	}
}
