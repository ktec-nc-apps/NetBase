<?php

declare(strict_types=1);

namespace OCA\NetBase\Controller;

use OCA\NetBase\AppInfo\Application;
use OCA\NetBase\Service\ProxyService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\IRequest;
use OCP\IURLGenerator;
use Psr\Log\LoggerInterface;

/**
 * Serves a device's own web interface on Nextcloud's origin.
 *
 * The path mirrors the device's, so relative links, stylesheets and scripts
 * inside the page keep working, and the browser treats the whole thing as
 * same-origin — which is what makes it displayable in a window inside NetBase
 * instead of a link that only works on the local network.
 */
class ProxyController extends Controller {
	public function __construct(
		IRequest $request,
		private ProxyService $proxy,
		private IURLGenerator $urls,
		private LoggerInterface $logger,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * The page runs in a sandboxed window with no access to Nextcloud, so it
	 * has no session to be recognised by; the signed ticket in the address is
	 * what authorises the request, and says whose it is.
	 */
	#[PublicPage]
	#[NoCSRFRequired]
	public function open(string $token, string $path = '') {
		try {
			$ticket = $this->proxy->redeem($token);
			$prefix = rtrim($this->urls->linkToRoute('netbase.proxy.open', ['token' => $token, 'path' => '']), '/');

			// The window adds a cache-buster of its own; a device that does not
			// expect it can answer with something else entirely, so it is taken
			// off again before the request leaves this server.
			$query = implode('&', array_filter(
				explode('&', (string)($_SERVER['QUERY_STRING'] ?? '')),
				static fn (string $pair) => $pair !== '' && !str_starts_with($pair, '_nb='),
			));
			$post = $this->request->getMethod() === 'POST' ? (array)$this->request->getParams() : [];
			unset($post['token'], $post['path'], $post['_route']);

			$result = $this->proxy->fetch($ticket['base'], $path, $query, $ticket['userId'], $prefix, $post, (string)$this->request->getHeader('Authorization'));
		} catch (\InvalidArgumentException $e) {
			return $this->problem($e->getMessage(), Http::STATUS_BAD_REQUEST);
		} catch (\RuntimeException $e) {
			return $this->problem($e->getMessage(), Http::STATUS_FORBIDDEN);
		} catch (\Throwable $e) {
			$this->logger->error('NetBase proxy: ' . $e->getMessage(), ['exception' => $e, 'app' => 'netbase']);
			return $this->problem($e->getMessage(), Http::STATUS_BAD_GATEWAY);
		}

		$headers = $result['headers'];
		// The window has no origin of its own, so anything it asks for itself
		// counts as cross-origin; the ticket, not the origin, is what decides.
		$headers['access-control-allow-origin'] = '*';
		$response = new DataDisplayResponse($result['body'], $result['status'], $headers);
		$response->setContentSecurityPolicy($this->policy());
		$response->cacheFor(0);
		return $response;
	}

	/**
	 * The device's page has to be allowed to be itself.
	 *
	 * Nextcloud's own policy is built for Nextcloud's own code: it pins scripts
	 * to a nonce, which a device's interface cannot know, and forbids being put
	 * in a frame at all. An empty policy is left untouched by the middleware, so
	 * this builds the whole thing — permissive towards the page, but still
	 * nailed to this origin, which is only ever the proxy itself.
	 */
	private function policy(): EmptyContentSecurityPolicy {
		$policy = new EmptyContentSecurityPolicy();
		$policy->allowEvalScript(true);
		$policy->allowEvalWasm(true);
		$policy->allowInlineStyle(true);
		$policy->addAllowedScriptDomain("'self'");
		$policy->addAllowedScriptDomain("'unsafe-inline'");
		$policy->addAllowedStyleDomain("'self'");
		$policy->addAllowedStyleDomain("'unsafe-inline'");
		foreach (["'self'", 'data:', 'blob:'] as $source) {
			$policy->addAllowedImageDomain($source);
			$policy->addAllowedMediaDomain($source);
			$policy->addAllowedFontDomain($source);
			$policy->addAllowedObjectDomain($source);
		}
		$policy->addAllowedConnectDomain("'self'");
		$policy->addAllowedFrameDomain("'self'");
		$policy->addAllowedChildSrcDomain("'self'");
		$policy->addAllowedWorkerSrcDomain("'self'");
		$policy->addAllowedWorkerSrcDomain('blob:');
		$policy->addAllowedFormActionDomain("'self'");
		// The window runs without an origin of its own, so it does not count as
		// 'self' to its own frames — a device page built out of frames would be
		// refused by anything narrower. What guards this address is the signed
		// ticket in it, not who is showing it.
		$policy->addAllowedFrameAncestorDomain('*');
		return $policy;
	}

	/** The window shows whatever comes back, so an error has to be readable. */
	private function problem(string $message, int $status): DataDisplayResponse {
		$html = '<!doctype html><meta charset="utf-8"><style>'
			. 'body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;'
			. 'font:15px/1.6 -apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif;background:#f4f6fb;color:#1e293b}'
			. 'div{max-width:36em;padding:28px;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(15,23,42,.1)}'
			. 'b{display:block;margin-bottom:8px}</style><div><b>⚠</b>'
			. htmlspecialchars($message, ENT_QUOTES) . '</div>';
		$response = new DataDisplayResponse($html, $status, ['Content-Type' => 'text/html; charset=utf-8']);
		$response->setContentSecurityPolicy($this->policy());
		$response->cacheFor(0);
		return $response;
	}
}
