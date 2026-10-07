<?php

declare(strict_types=1);

namespace OCA\NetBase\Settings;

use OCA\NetBase\AppInfo\Application;
use OCA\NetBase\Service\AiService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IGroupManager;
use OCP\Settings\ISettings;
use OCP\Util;

/**
 * The AI assistant's settings, under the tool permissions in the NetBase
 * section: on or off, who may use it, what it may read and whether it may
 * search the web. Without AI-Hub it is all shown greyed out.
 */
class AiAdmin implements ISettings {
	public function __construct(
		private AiService $ai,
		private IGroupManager $groups,
	) {
	}

	public function getForm(): TemplateResponse {
		Util::addScript(Application::APP_ID, 'admin-ai');
		Util::addStyle(Application::APP_ID, 'admin-ai');
		$groups = [];
		foreach ($this->groups->search('') as $g) {
			$groups[] = ['id' => $g->getGID(), 'name' => $g->getDisplayName()];
		}
		return new TemplateResponse(Application::APP_ID, 'admin-ai', [
			'hub' => $this->ai->hubStatus(),
			'settings' => $this->ai->settings(),
			'groups' => $groups,
		], '');
	}

	public function getSection(): string {
		return Application::APP_ID;
	}

	/** At the top of the section, above the tool permissions (50), to match the
	    other Base-series apps where the AI assistant is the first item. */
	public function getPriority(): int {
		return 10;
	}
}
