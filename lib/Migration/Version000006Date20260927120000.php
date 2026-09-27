<?php

declare(strict_types=1);

namespace OCA\NetBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Where a device is, in three parts: the floor or place ("1F", the location
 * column), the room ("Guest room") and where in it it is installed ("Wall").
 * Nullable for the same reason as location.
 */
class Version000006Date20260927120000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('netbase_devices')) {
			return null;
		}
		$table = $schema->getTable('netbase_devices');
		$changed = false;
		foreach (['room', 'mount'] as $col) {
			if (!$table->hasColumn($col)) {
				$table->addColumn($col, Types::STRING, ['notnull' => false, 'length' => 255]);
				$changed = true;
			}
		}
		return $changed ? $schema : null;
	}
}
