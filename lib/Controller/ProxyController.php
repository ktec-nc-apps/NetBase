<?php

declare(strict_types=1);

namespace OCA\NetBase\Controller;

use OCA\NetBase\AppInfo\Application;
use OCA\NetBase\Http\ProxyResponse;
use OCA\NetBase\Service\L10nService;
use OCA\NetBase\Service\ProxyService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\IOutput;
use OCP\AppFramework\Http\RedirectResponse;
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
		private L10nService $l,
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
			$method = strtoupper($this->request->getMethod());
			$type = strtolower((string)$this->request->getHeader('Content-Type'));
			$form = $type === '' || str_contains($type, 'form-urlencoded') || str_contains($type, 'multipart/');
			// Only what the request actually carried. Taken from the merged
			// parameters, the address's own query string came back as a body:
			// a camera's page asks it things with an empty POST and the
			// question in the address, and handed a body it had not been
			// promised the device answered 400 and its sign-in screen never
			// showed the dialog it owes the person.
			$post = $method !== 'GET' && $form ? (array)($_POST ?? []) : [];
			unset($post['token'], $post['path'], $post['_route']);
			// A page that talks to its device in JSON, or in anything else of its
			// own devising, is carried through untouched rather than rebuilt.
			$body = $method !== 'GET' && !$form ? (string)file_get_contents('php://input') : '';
			// An XHR that sets no content type at all is common in device
			// firmware — a camera here signs in with one — and PHP will not
			// parse a body it has not been told the shape of. Taking it as a
			// form then threw the sign-in away and the device saw an empty
			// request. If nothing was parsed and something was sent, what was
			// sent is what goes on.
			if ($method !== 'GET' && $form && $post === []) {
				$raw = (string)file_get_contents('php://input');
				if ($raw !== '') {
					$body = $raw;
					$form = false;
				}
			}

			if (isset($post['__netbase_user'])) {
				// The person answered the device's request for a password. It is
				// kept for them alone, and the page is asked for again.
				$this->proxy->rememberAuth($ticket['base'], $ticket['userId'], (string)$post['__netbase_user'], (string)($post['__netbase_pass'] ?? ''));
				return new RedirectResponse(
					rtrim($this->urls->linkToRoute('netbase.proxy.open', ['token' => $token, 'path' => $path]), '/') . ($path === '' ? '/' : ''),
				);
			}

			$forward = [
				'method' => $method,
				'post' => $post,
				'body' => $body,
				// Every file the form carried; the request object exposes them one
				// name at a time, and a device form may use any name it likes.
				'files' => $method !== 'GET' ? (array)($_FILES ?? []) : [],
				'headers' => $this->browserHeaders(),
				'authorization' => (string)$this->request->getHeader('Authorization'),
			];

			// Anything that is not a page — a firmware image, a backup, a camera
			// stream — goes straight through to the browser as it arrives.
			$response = new ProxyResponse(function (IOutput $output) use ($ticket, $token, $path, $query, $prefix, $forward): void {
				try {
					$result = $this->proxy->deliver($ticket['base'], $path, $query, $ticket['userId'], $prefix, $forward, $output);
				} catch (\Throwable $e) {
					// A probed device timing out, refusing the connection or failing
					// TLS is an ordinary outcome for a network tool, not a fault in
					// NetBase — the browser is still shown a problem page. Logged at
					// info so a customer's admin log is not flooded with warnings
					// every time a device is slow or asleep.
					$this->logger->info('NetBase proxy: ' . $e->getMessage(), ['exception' => $e, 'app' => 'netbase']);
					$output->setHttpResponseCode(Http::STATUS_BAD_GATEWAY);
					$output->setHeader('Content-Type: text/html; charset=utf-8');
					$output->setOutput($this->problemPage($e->getMessage()));
					return;
				}
				if (!empty($result['streamed'])) {
					return;
				}
				$this->writeBuffered($output, $result, $token, $path);
			});
			$result = null;
		} catch (\InvalidArgumentException $e) {
			return $this->problem($e->getMessage(), Http::STATUS_BAD_REQUEST);
		} catch (\RuntimeException $e) {
			return $this->problem($e->getMessage(), Http::STATUS_FORBIDDEN);
		} catch (\Throwable $e) {
			$this->logger->warning('NetBase proxy: ' . $e->getMessage(), ['exception' => $e, 'app' => 'netbase']);
			return $this->problem($e->getMessage(), Http::STATUS_BAD_GATEWAY);
		}

		$response->setContentSecurityPolicy($this->policy());
		$response->cacheFor(0);
		return $response;
	}

	/**
	 * A page, once it has been read whole and its addresses put right.
	 *
	 * @param array<string, mixed> $result
	 */
	private function writeBuffered(IOutput $output, array $result, string $token, string $path): void {
		if (!empty($result['needsPassword'])) {
			$page = $this->passwordPage($token, $path, (string)($result['realm'] ?? ''));
			$output->setHttpResponseCode(Http::STATUS_OK);
			$output->setHeader('Content-Type: text/html; charset=utf-8');
			$output->setOutput($page);
			return;
		}
		// The status line as well as the code. The framework has already sent
		// "HTTP/1.1 200 OK" for this response before ever calling us, and under
		// FastCGI that is what decides the status — so a device's 302 arrived at
		// the browser as a 200 with a Location nobody acted on, and its page
		// stayed blank. The streaming path always did both; this one now does
		// too.
		$status = (int)$result['status'] ?: 200;
		$output->setHeader('HTTP/1.1 ' . $status . ' ' . (ProxyService::REASONS[$status] ?? 'Status'));
		$output->setHttpResponseCode($status);
		foreach ((array)$result['headers'] as $name => $value) {
			$output->setHeader($name . ': ' . $value);
		}
		// The window has no origin of its own, so anything it asks for itself
		// counts as cross-origin; the ticket, not the origin, is what decides.
		$output->setHeader('Access-Control-Allow-Origin: *');
		// Nextcloud sends no-referrer on everything it serves, which is right
		// for Nextcloud and wrong here: a camera at one site turns every page
		// after the sign-in away unless the request says which of its own pages
		// it came from. Same-origin keeps the referer inside this server — it
		// never leaves for anywhere else — and the proxy rewrites it into the
		// device's own address before sending it on.
		$output->setHeader('Referrer-Policy: same-origin');
		$output->setOutput((string)$result['body']);
	}

	/** What the browser asked for, as far as a device may need to know. */
	private function browserHeaders(): array {
		$wanted = ['accept', 'accept-language', 'range', 'if-none-match', 'if-modified-since', 'content-type', 'x-requested-with'];
		$headers = [];
		foreach ($wanted as $name) {
			$value = (string)$this->request->getHeader($name);
			if ($value !== '') {
				$headers[$name] = $value;
			}
		}
		$page = $this->pageCookies();
		if ($page !== '') {
			$headers['cookie'] = $page;
		}
		// Where the request came from, said in the device's own terms. A camera
		// here refuses every page after the sign-in unless it is told, and the
		// browser's own Referer names this server, which means nothing to it
		// and gives away where the window lives. The proxy service turns this
		// into the device's address before sending it.
		$referer = (string)$this->request->getHeader('Referer');
		if ($referer !== '') {
			$headers['referer'] = $referer;
		}
		return $headers;
	}

	/**
	 * The cookies the device's own page set, and only those.
	 *
	 * A camera here signs in and then remembers it in a cookie the page writes
	 * itself, which the device reads back on the next request; without it the
	 * device sent the window straight back to the login screen. Those cookies
	 * live on this server's name, alongside Nextcloud's, so the ones belonging
	 * to Nextcloud are left out by name — the session above all, which must
	 * never leave this origin.
	 */
	private function pageCookies(): string {
		$mine = [];
		foreach ($_COOKIE as $name => $value) {
			$lower = strtolower((string)$name);
			if (str_starts_with($lower, 'oc') || str_starts_with($lower, 'nc_')
				|| str_starts_with($lower, '__host-') || str_starts_with($lower, '__secure-')
				|| $lower === 'cookie_test' || !is_string($value)) {
				continue;
			}
			$mine[] = $name . '=' . $value;
		}
		return implode('; ', $mine);
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
	/**
	 * The device's page has to be allowed to be itself — and nothing else.
	 *
	 * Nextcloud's own policy is built for Nextcloud's own code: it pins scripts
	 * to a nonce a device cannot know. This one is permissive about what the
	 * page may do and strict about where it may reach: every source is the
	 * proxy's own path, so whatever the page loads, submits or asks for goes
	 * back through the proxy. Even shown with an origin of its own, it cannot
	 * call a Nextcloud endpoint.
	 */
	private function policy(): EmptyContentSecurityPolicy {
		$here = $this->urls->getAbsoluteURL('/apps/netbase/proxy/');
		$policy = new EmptyContentSecurityPolicy();
		$policy->allowInlineStyle(true);
		$policy->addAllowedScriptDomain($here);
		$policy->addAllowedScriptDomain("'unsafe-inline'");
		// Written as sources rather than as allowEvalScript(), which Nextcloud 34
		// no longer has: a device page that needs eval gets the same permission
		// on every version NetBase supports.
		$policy->addAllowedScriptDomain("'unsafe-eval'");
		$policy->addAllowedScriptDomain("'wasm-unsafe-eval'");
		$policy->addAllowedStyleDomain($here);
		$policy->addAllowedStyleDomain("'unsafe-inline'");
		foreach ([$here, 'data:', 'blob:'] as $source) {
			$policy->addAllowedImageDomain($source);
			$policy->addAllowedMediaDomain($source);
			$policy->addAllowedFontDomain($source);
			$policy->addAllowedObjectDomain($source);
		}
		$policy->addAllowedConnectDomain($here);
		$policy->addAllowedFrameDomain($here);
		$policy->addAllowedWorkerSrcDomain($here);
		$policy->addAllowedWorkerSrcDomain('blob:');
		$policy->addAllowedFormActionDomain($here);
		// The window itself is inside NetBase, which is this origin.
		$policy->addAllowedFrameAncestorDomain("'self'");
		return $policy;
	}

	/**
	 * The device wants a password, and the browser will not ask for one.
	 *
	 * A window kept away from Nextcloud has no origin of its own, and browsers
	 * refuse to show their sign-in box in one. So NetBase asks instead, and
	 * keeps the answer for this person and this device only.
	 */
	private function passwordPage(string $token, string $path, string $realm): string {
		$action = rtrim($this->urls->linkToRoute('netbase.proxy.open', ['token' => $token, 'path' => $path]), '/') . ($path === '' ? '/' : '');
		$title = $this->l->t('This device is asking for a user name and password');
		$hint = $realm !== ''
			? $this->l->t('It calls the protected part “%s”.', [$realm])
			: $this->l->t('NetBase will remember it for you, for this device only.');
		$html = '<!doctype html><meta charset="utf-8"><title>' . htmlspecialchars($title, ENT_QUOTES) . '</title><style>'
			. 'body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;'
			. 'font:15px/1.6 -apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif;background:#f4f6fb;color:#1e293b}'
			. 'form{width:min(28em,90vw);padding:28px;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(15,23,42,.1)}'
			. 'b{display:block;font-size:1.05em;margin-bottom:4px}p{margin:0 0 18px;color:#64748b;font-size:.9em}'
			. 'label{display:block;margin-bottom:12px}span{display:block;font-size:.85em;margin-bottom:4px}'
			. 'input{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}'
			. 'button{margin-top:6px;padding:9px 18px;border:0;border-radius:8px;background:#0f766e;color:#fff;font:inherit;cursor:pointer}'
			. '</style><form method="post" action="' . htmlspecialchars($action, ENT_QUOTES) . '">'
			. '<b>🔒 ' . htmlspecialchars($title, ENT_QUOTES) . '</b>'
			. '<p>' . htmlspecialchars($hint, ENT_QUOTES) . '</p>'
			. '<label><span>' . htmlspecialchars($this->l->t('User name'), ENT_QUOTES) . '</span>'
			. '<input name="__netbase_user" autocomplete="username" autofocus></label>'
			. '<label><span>' . htmlspecialchars($this->l->t('Password'), ENT_QUOTES) . '</span>'
			. '<input name="__netbase_pass" type="password" autocomplete="current-password"></label>'
			. '<button type="submit">' . htmlspecialchars($this->l->t('Sign in'), ENT_QUOTES) . '</button>'
			. '</form>' . $this->locate();
		return $html;
	}

	/** NetBase's own pages report their place, so the window's address line is right. */
	private function locate(): string {
		return '<script>try{parent.postMessage({netbase:"here",href:location.pathname+location.search},"*")}catch(e){}</script>';
	}

	/** The window shows whatever comes back, so an error has to be readable. */
	private function problem(string $message, int $status): DataDisplayResponse {
		$response = new DataDisplayResponse($this->problemPage($message), $status, ['Content-Type' => 'text/html; charset=utf-8']);
		$response->setContentSecurityPolicy($this->policy());
		$response->cacheFor(0);
		return $response;
	}

	private function problemPage(string $message): string {
		$html = '<!doctype html><meta charset="utf-8"><style>'
			. 'body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;'
			. 'font:15px/1.6 -apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif;background:#f4f6fb;color:#1e293b}'
			. 'div{max-width:36em;padding:28px;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(15,23,42,.1)}'
			. 'b{display:block;margin-bottom:8px}</style><div><b>⚠</b>'
			. htmlspecialchars($message, ENT_QUOTES) . '</div>' . $this->locate();
		return $html;
	}
}
