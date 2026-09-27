<?php

declare(strict_types=1);

namespace OCA\NetBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Where a device is installed ("Office 2F Reception room"), written by a person.
 * Nullable: an empty string is not a valid default on every database.
 */
class Version000005Date20260927000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('netbase_devices')) {
			return null;
		}
		$table = $schema->getTable('netbase_devices');
		if ($table->hasColumn('location')) {
			return null;
		}
		$table->addColumn('location', Types::STRING, ['notnull' => false, 'length' => 255]);
		return $schema;
	}
}
