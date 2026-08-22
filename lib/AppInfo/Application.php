<?php

declare(strict_types=1);

namespace OCA\NetBase\AppInfo;

use OCA\NetBase\Service\PermissionService;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\INavigationManager;
use OCP\IURLGenerator;
use OCP\L10N\IFactory;

class Application extends App implements IBootstrap {
	public const APP_ID = 'netbase';

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void {
	}

	public function boot(IBootContext $context): void {
		// The menu entry is added here rather than declared in info.xml so that
		// it can be left out for people who are not allowed to use any of the
		// tools — an instance where everything is administrator-only should not
		// advertise NetBase to everyone else.
		$context->injectFn(function (
			INavigationManager $navigationManager,
			IURLGenerator $urlGenerator,
			IFactory $l10nFactory,
			PermissionService $permissions,
		) {
			if ($permissions->hidesEmptyMenu() && !$permissions->canUseAnything()) {
				return;
			}
			$navigationManager->add(static function () use ($urlGenerator, $l10nFactory) {
				return [
					'id' => self::APP_ID,
					'order' => 82,
					'href' => $urlGenerator->linkToRoute('netbase.page.index'),
					'icon' => $urlGenerator->imagePath(self::APP_ID, 'app.svg'),
					'name' => $l10nFactory->get(self::APP_ID)->t('NetBase'),
				];
			});
		});
	}
}
