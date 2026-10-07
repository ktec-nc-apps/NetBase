<?php

declare(strict_types=1);

namespace OCA\NetBase\Controller;

use OCA\NetBase\AppInfo\Application;
use OCA\NetBase\Service\AiService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * The AI assistant's questions from the page -- may I, ask this, is the answer
 * there yet, keep my width -- and the administrator's settings.
 */
class AiController extends Controller {
	public function __construct(
		IRequest $request,
		private AiService $ai,
		private IUserSession $userSession,
		private IConfig $config,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	private function uid(): ?string {
		$user = $this->userSession->getUser();
		return $user === null ? null : $user->getUID();
	}

	/** A person who may use nothing in NetBase is answered show:false, like anyone not allowed. */
	#[NoAdminRequired]
	public function status(): JSONResponse {
		$uid = $this->uid();
		return new JSONResponse($uid === null ? ['show' => false] : $this->ai->status($uid));
	}

	#[NoAdminRequired]
	public function ask(): JSONResponse {
		$uid = $this->uid();
		if ($uid === null) {
			return new JSONResponse(['error' => 'not-allowed'], Http::STATUS_FORBIDDEN);
		}
		$history = $this->request->getParam('history', []);
		$context = $this->request->getParam('context', []);
		$message = $this->request->getParam('message', '');
		$message = is_string($message) ? mb_substr($message, 0, 20000) : '';
		$conversation = $this->request->getParam('conversation', '');
		$images = $this->request->getParam('images', []);
		// "approve <hash>" is the administrator's own word that one refused
		// command may run. It is taken from their message, here, and never from
		// anything the model wrote (review 2026-10-04, medium 8); the message
		// still goes to the model, which then calls the tool again.
		if (preg_match('/^\s*(?:approve|承認)\s+([0-9a-f]{16})\s*$/iu', $message, $m) === 1) {
			$this->ai->approve($uid, strtolower($m[1]));
		}
		$lang = $this->config->getUserValue($uid, 'core', 'lang', $this->config->getSystemValueString('default_language', 'en'));
		$out = $this->ai->ask(
			$uid,
			is_array($history) ? $history : [],
			$message,
			is_array($context) ? $context : [],
			str_starts_with((string)$lang, 'ja') ? 'ja' : (string)$lang,
			is_string($conversation) ? $conversation : '',
			is_array($images) ? $images : [],
		);
		$status = isset($out['error']) ? ($out['error'] === 'not-allowed' ? Http::STATUS_FORBIDDEN : Http::STATUS_SERVICE_UNAVAILABLE) : Http::STATUS_OK;
		return new JSONResponse($out, $status);
	}

	#[NoAdminRequired]
	public function result(string $id): JSONResponse {
		$uid = $this->uid();
		return new JSONResponse($uid === null ? ['state' => 'unknown'] : $this->ai->result($uid, $id));
	}

	/** Forget a conversation's server-side memory (the panel's "New conversation"). */
	#[NoAdminRequired]
	public function forget(): JSONResponse {
		$uid = $this->uid();
		if ($uid === null) {
			return new JSONResponse(['error' => 'not-allowed'], Http::STATUS_FORBIDDEN);
		}
		$conversation = $this->request->getParam('conversation', '');
		$this->ai->forget($uid, is_string($conversation) ? $conversation : '');
		return new JSONResponse(['ok' => true]);
	}

	/** The width of the assistant's column, kept per person: "500px" or "30%". */
	#[NoAdminRequired]
	public function saveWidth(): JSONResponse {
		$uid = $this->uid();
		if ($uid === null) {
			return new JSONResponse(['error' => 'not-allowed'], Http::STATUS_FORBIDDEN);
		}
		if (!$this->ai->saveWidth($uid, $this->request->getParam('width'))) {
			return new JSONResponse(['error' => 'bad-width', 'width' => $this->ai->width($uid)], Http::STATUS_BAD_REQUEST);
		}
		return new JSONResponse(['width' => $this->ai->width($uid)]);
	}

	/** Administrators only (no NoAdminRequired). */
	public function saveAdmin(): JSONResponse {
		if (!$this->ai->hubPresent()) {
			return new JSONResponse(['error' => 'AI-Hub is not installed'], Http::STATUS_CONFLICT);
		}
		return new JSONResponse($this->ai->saveSettings([
			'enabled' => $this->request->getParam('enabled'),
			'users' => $this->request->getParam('users'),
			'groups' => $this->request->getParam('groups', []),
			'read' => $this->request->getParam('read', []),
			'search' => $this->request->getParam('search'),
			'adminTools' => $this->request->getParam('adminTools'),
		]));
	}
}
