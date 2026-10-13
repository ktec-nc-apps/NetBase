<?php

declare(strict_types=1);

namespace OCA\NetBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * A MAC address typed by hand for Wake-on-LAN (wake_mac).
 *
 * A device that is switched off answers nothing, and across a router or a
 * container's bridge its MAC is never seen at all — yet a magic packet is
 * addressed to nothing else. The scan's own mac column is the row's identity,
 * so the typed one is kept apart from it. Nullable, like location.
 */
class Version000007Date20261013000000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('netbase_devices')) {
			return null;
		}
		$table = $schema->getTable('netbase_devices');
		if ($table->hasColumn('wake_mac')) {
			return null;
		}
		$table->addColumn('wake_mac', Types::STRING, ['notnull' => false, 'length' => 17]);
		return $schema;
	}
}
