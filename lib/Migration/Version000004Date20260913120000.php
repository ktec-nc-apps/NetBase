<?php

declare(strict_types=1);

namespace OCA\NetBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * The old store for saved connections, taken away.
 *
 * Connections moved to RegiBase in 0.6.0, and that release said plainly that
 * anything kept here would not come with them: what this table held was sealed
 * with the instance secret, which lives on the same server as the table, and
 * carrying those secrets across would have carried that weakness with them.
 *
 * Nothing has read this table since 0.6.0. Dropping it means the passwords it
 * still held stop existing, which is the point.
 */
class Version000004Date20260913120000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('netbase_endpoints')) {
			$schema->dropTable('netbase_endpoints');
		}

		return $schema;
	}
}
