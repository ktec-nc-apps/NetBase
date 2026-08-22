<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\AppInfo\Application;
use OCP\IConfig;
use OCP\IL10N;
use OCP\IUserSession;
use OCP\L10N\IFactory;

/**
 * Translations for text the services generate.
 *
 * Findings are written on the server, so they cannot be translated in the
 * browser the way the interface is. This resolves the language the same way the
 * page does: the language chosen in NetBase, or Nextcloud's own if that is set
 * to follow it.
 */
class L10nService {
	private ?IL10N $l = null;

	public function __construct(
		private IFactory $factory,
		private IConfig $config,
		private IUserSession $userSession,
	) {
	}

	public function get(): IL10N {
		if ($this->l === null) {
			$user = $this->userSession->getUser();
			$language = $user !== null
				? $this->config->getUserValue($user->getUID(), Application::APP_ID, 'language', 'auto')
				: 'auto';
			$this->l = $this->factory->get(Application::APP_ID, $language === 'auto' ? null : $language);
		}
		return $this->l;
	}

	/** @param array<int, string|int|float> $parameters */
	public function t(string $text, array $parameters = []): string {
		return $this->get()->t($text, $parameters);
	}
}
