<?php

declare(strict_types=1);

namespace OCA\NetBase\Controller;

use OCA\NetBase\AppInfo\Application;
use OCA\NetBase\Service\PermissionService;
use OCP\App\IAppManager;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\L10N\IFactory;
use OCP\Util;

class PageController extends Controller {
	public function __construct(
		IRequest $request,
		private IAppManager $appManager,
		private IConfig $config,
		private IUserSession $userSession,
		private IFactory $l10nFactory,
		private PermissionService $permissions,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse {
		$user = $this->userSession->getUser();
		$lang = $user ? $this->config->getUserValue($user->getUID(), Application::APP_ID, 'language', 'auto') : 'auto';
		$l = $this->l10nFactory->get(Application::APP_ID, $lang === 'auto' ? null : $lang);

		// Someone who may not use a single tool has nothing to load here, and
		// the menu entry is already hidden from them.
		if (!$this->permissions->canUseAnything()) {
			$denied = new TemplateResponse(Application::APP_ID, 'denied', [], TemplateResponse::RENDER_AS_ERROR);
			$denied->setStatus(Http::STATUS_FORBIDDEN);
			return $denied;
		}

		Util::addStyle(Application::APP_ID, 'netbase');
		// Runtime-only Vue with a precompiled render function, so the page needs
		// no template compiler and therefore no eval().
		Util::addScript(Application::APP_ID, 'vue.runtime.global.prod');
		Util::addScript(Application::APP_ID, 'vue-private');
		Util::addScript(Application::APP_ID, 'netbase.dist');

		// Painting the chosen theme server-side keeps a dark-mode user from
		// seeing a white flash while the settings request is still in flight.
		$theme = $user ? $this->config->getUserValue($user->getUID(), Application::APP_ID, 'theme', 'auto') : 'auto';
		if (!in_array($theme, ['auto', 'light', 'dark'], true)) {
			$theme = 'auto';
		}

		return new TemplateResponse(Application::APP_ID, 'main', [
			'version' => $this->appManager->getAppVersion(Application::APP_ID),
			'theme' => $theme,
			'loading' => $l->t('Loading…'),
		]);
	}
}
