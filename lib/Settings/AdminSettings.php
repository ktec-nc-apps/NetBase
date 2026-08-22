<?php

declare(strict_types=1);

namespace OCA\NetBase\Settings;

use OCA\NetBase\AppInfo\Application;
use OCA\NetBase\Service\DiscoveryService;
use OCA\NetBase\Service\ExecService;
use OCA\NetBase\Service\OuiService;
use OCA\NetBase\Service\PermissionService;
use OCA\NetBase\Service\RequirementsService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IConfig;
use OCP\Settings\ISettings;
use OCP\Util;

class AdminSettings implements ISettings {
	public function __construct(
		private PermissionService $permissions,
		private DiscoveryService $discovery,
		private ExecService $exec,
		private OuiService $oui,
		private RequirementsService $requirements,
		private IConfig $config,
	) {
	}

	public function getForm(): TemplateResponse {
		Util::addStyle(Application::APP_ID, 'admin');
		Util::addScript(Application::APP_ID, 'admin');

		return new TemplateResponse(Application::APP_ID, 'admin', [
			'requirements' => $this->requirements->report(),
			'tools' => PermissionService::TOOLS,
			'levels' => $this->permissions->levels(),
			'groups' => $this->permissions->groups(),
			'hideEmptyMenu' => $this->permissions->hidesEmptyMenu(),
			'maxHosts' => (int)$this->config->getAppValue('netbase', 'max_hosts', '65536'),
			'ouiEntries' => $this->oui->count(),
			'neighbourLimits' => $this->discovery->neighbourLimits(),
		], '');
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	public function getPriority(): int {
		return 50;
	}
}
