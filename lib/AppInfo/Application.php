<?php

declare(strict_types=1);

namespace OCA\NetBase\AppInfo;

use OCA\NetBase\Service\AiService;
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

	/**
	 * Language codes NetBase once shipped under, and the Nextcloud code each now means.
	 * Nextcloud uses a translation for the language set in a user's account only when the
	 * file has that exact name, and it has pt_BR/pt_PT and zh_CN/zh_TW/zh_HK, never a bare
	 * pt or zh. A stored "pt" or "zh" is read as the code it now means.
	 */
	public const OLD_LANGUAGES = ['pt' => 'pt_PT', 'zh' => 'zh_CN'];

	/**
	 * l10n files that carry the same strings as another and so are not offered in the
	 * language picker: zh (= zh_CN), kept for the browser-language fallback so an account
	 * in zh_TW or zh_HK gets Chinese rather than English; and pt_BR (= pt_PT): the
	 * Portuguese is written the European way, and is shipped under pt_BR too so an account
	 * in Brazilian Portuguese gets Portuguese rather than English.
	 */
	public const SAME_AS = ['zh' => 'zh_CN', 'pt_BR' => 'pt_PT'];

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void {
	}

	public function boot(IBootContext $context): void {
		// AI-Hub, when it is installed, is told what NetBase's assistant is -- in
		// every request, since the hub keeps scenarios in memory only and the
		// request that works out an answer is not the one that asked.
		if (class_exists('\\OCA\\AIHub\\Service\\HubService')) {
			$context->injectFn(static function (AiService $ai): void {
				$ai->registerScenario();
			});
		}
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
