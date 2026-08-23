<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\DeviceMapper;
use OCP\IConfig;
use OCP\Security\ICrypto;
use Psr\Log\LoggerInterface;

/**
 * A device's own web interface, served through this server.
 *
 * A link to http://192.168.1.20 is only useful to someone sitting on that
 * network. This fetches the page from the server — which is on that network —
 * and hands it back on Nextcloud's own origin, so the device's interface can
 * be used from anywhere the Nextcloud is reachable, in a window inside the app.
 *
 * Because the fetch happens server-side, it is deliberately fenced in: only
 * addresses on this server's own networks, or hosts NetBase has actually seen
 * during a scan, can be reached. NetBase is a network tool, not an open proxy.
 */
class ProxyService {
	/** The name NetBase gives the window's own document, so a device page can aim at it. */
	public const WINDOW_NAME = '_netbase_window';

	private const MAX_BYTES = 16777216;
	private const TIMEOUT = 20;

	/** Headers that belong to the hop, not to the content. */
	private const DROP_HEADERS = [
		'transfer-encoding', 'content-encoding', 'content-length', 'connection',
		'keep-alive', 'x-frame-options', 'content-security-policy',
		'content-security-policy-report-only', 'strict-transport-security',
		'public-key-pins', 'upgrade', 'alt-svc',
	];

	public function __construct(
		private DiscoveryService $discovery,
		private DeviceMapper $devices,
		private ToolService $tools,
		private ICrypto $crypto,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	public function available(): bool {
		return function_exists('curl_init');
	}

	/**
	 * A ticket for one device address, for one person, for a while.
	 *
	 * The window that shows a device page runs without access to Nextcloud —
	 * that is what stops a hostile device from acting as the signed-in user —
	 * which also means its requests cannot rely on the session. The address
	 * therefore travels signed, so the proxy can tell that NetBase itself
	 * issued it, to whom, and until when.
	 */
	public function issue(string $base, string $userId, int $seconds = 14400): string {
		$base = $this->validateBase($base);
		$claim = json_encode([
			'b' => $base,
			'u' => $userId,
			'e' => time() + max(60, $seconds),
		], JSON_UNESCAPED_SLASHES);
		$payload = self::pack((string)$claim);
		return $payload . '.' . self::pack($this->crypto->calculateHMAC($payload, $this->secret()));
	}

	/**
	 * @return array{base: string, userId: string}
	 * @throws \RuntimeException when the ticket is not ours, or no longer valid
	 */
	public function redeem(string $token): array {
		$parts = explode('.', $token, 2);
		if (count($parts) !== 2) {
			throw new \RuntimeException('That window has no valid ticket. Open the device again from the device list.');
		}
		[$payload, $signature] = $parts;
		$expected = self::pack($this->crypto->calculateHMAC($payload, $this->secret()));
		if (!hash_equals($expected, $signature)) {
			throw new \RuntimeException('That window has no valid ticket. Open the device again from the device list.');
		}
		$claim = json_decode(self::unpack($payload), true);
		if (!is_array($claim) || !isset($claim['b'], $claim['u'], $claim['e'])) {
			throw new \RuntimeException('That window has no valid ticket. Open the device again from the device list.');
		}
		if ((int)$claim['e'] < time()) {
			throw new \RuntimeException('This window has been open for a long time and its ticket has expired. Open the device again from the device list.');
		}
		return ['base' => (string)$claim['b'], 'userId' => (string)$claim['u']];
	}

	private function secret(): string {
		return $this->config->getSystemValueString('secret', '') . '|netbase-proxy';
	}

	private static function pack(string $value): string {
		return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
	}

	private static function unpack(string $value): string {
		$padded = str_pad(strtr($value, '-_', '+/'), (int)(ceil(strlen($value) / 4) * 4), '=');
		return (string)base64_decode($padded, true);
	}

	/**
	 * Fetch one resource and return it ready to be handed to the browser.
	 *
	 * @param array<string, string> $post form fields to forward, if any
	 * @return array{status: int, headers: array<string, string>, body: string, html: bool}
	 */
	public function fetch(string $base, string $path, string $query, string $userId, string $prefix, array $post = [], string $authorization = ''): array {
		$base = $this->validateBase($base);
		if ($authorization === '') {
			// A device that asked for a password earlier is answered without
			// asking the person again.
			$authorization = $this->recallAuth($base, $userId);
		}
		if (!$this->available()) {
			throw new \RuntimeException('The PHP curl extension is not installed on this server');
		}
		$url = $base . '/' . ltrim($path, '/');
		if ($query !== '') {
			$url .= '?' . $query;
		}

		$curl = curl_init($url);
		$headers = [];
		curl_setopt_array($curl, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT => self::TIMEOUT,
			CURLOPT_CONNECTTIMEOUT => 8,
			// Device interfaces almost always have a self-signed certificate,
			// and the connection stays inside the local network.
			CURLOPT_SSL_VERIFYPEER => false,
			CURLOPT_SSL_VERIFYHOST => 0,
			// Redirects are rewritten and handed back to the browser instead,
			// so the window's address bar keeps up with where it is.
			CURLOPT_FOLLOWLOCATION => false,
			// An empty file name starts the cookie engine without one: a device's
			// session cookie has no expiry, and those are never written to a
			// cookie file — the sign-in would be forgotten between one page and
			// the next. They are kept by hand instead, just below.
			CURLOPT_COOKIEFILE => '',
			CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; NetBase for Nextcloud)',
			CURLOPT_HEADERFUNCTION => function ($handle, string $line) use (&$headers) {
				$parts = explode(':', $line, 2);
				if (count($parts) === 2) {
					$headers[strtolower(trim($parts[0]))] = trim($parts[1]);
				}
				return strlen($line);
			},
		]);
		foreach ($this->loadCookies($userId, $base) as $cookie) {
			curl_setopt($curl, CURLOPT_COOKIELIST, $cookie);
		}
		if ($authorization !== '') {
			// A device that asks for a password does so through the browser, on
			// this server's address; the answer is handed straight back to it.
			curl_setopt($curl, CURLOPT_HTTPHEADER, ['Authorization: ' . $authorization]);
		}
		if ($post !== []) {
			curl_setopt($curl, CURLOPT_POST, true);
			curl_setopt($curl, CURLOPT_POSTFIELDS, http_build_query($post));
		}
		$body = curl_exec($curl);
		$status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
		$error = curl_error($curl);
		$this->saveCookies($userId, $base, (array)curl_getinfo($curl, CURLINFO_COOKIELIST));
		curl_close($curl);

		if (!is_string($body)) {
			throw new \RuntimeException($error !== '' ? $error : 'The device did not answer');
		}
		if (strlen($body) > self::MAX_BYTES) {
			$body = substr($body, 0, self::MAX_BYTES);
		}

		// A sandboxed window gets no sign-in box from the browser, so NetBase
		// has to ask on the device's behalf.
		$challenge = $headers['www-authenticate'] ?? '';
		$needsPassword = $status === 401 && stripos($challenge, 'basic') !== false;
		if ($needsPassword && $authorization !== '') {
			// What was remembered is no longer accepted; ask again.
			$this->forgetAuth($base, $userId);
		}

		$type = trim($headers['content-type'] ?? '');
		if ($type === '') {
			// Some device servers send no content type at all; a browser would
			// then be told to download the page instead of showing it.
			$start = ltrim(substr($body, 0, 256));
			$type = ($start !== '' && ($start[0] === '<' || stripos($start, '<!doctype') === 0))
				? 'text/html'
				: 'application/octet-stream';
		}
		$isHtml = str_contains(strtolower($type), 'html');
		if ($isHtml) {
			// Japanese device interfaces are often EUC-JP or Shift_JIS and say so
			// only in the markup. Anything inserted above that declaration can
			// push it out of the browser's reach, so it is promoted to the
			// header, where it is read first and cannot be pushed anywhere.
			if (!str_contains(strtolower($type), 'charset') && preg_match('#charset\s*=\s*["\']?([a-z0-9_-]+)#i', substr($body, 0, 4096), $m) === 1) {
				$type = 'text/html; charset=' . $m[1];
			}
			$body = $this->rewriteHtml($body, $base, $prefix, $path);
		} elseif (str_contains(strtolower($type), 'css')) {
			$body = $this->rewriteCss($body, $prefix);
		}

		$out = [];
		foreach ($headers as $name => $value) {
			if (in_array($name, self::DROP_HEADERS, true)) {
				continue;
			}
			if ($name === 'location') {
				$value = $this->rewriteUrl($value, $base, $prefix, $path);
			}
			if ($name === 'set-cookie') {
				// The jar already holds it; passing it on would set a cookie on
				// Nextcloud's own domain.
				continue;
			}
			$out[$name] = $value;
		}
		$out['content-type'] = $type;

		return [
			'status' => $status,
			'headers' => $out,
			'body' => $body,
			'html' => $isHtml,
			'needsPassword' => $needsPassword,
			'realm' => $this->realm($challenge),
		];
	}

	// ------------------------------------------------------------------ safety

	/** Only this server's own networks, or a device a scan has actually seen. */
	public function validateBase(string $base): string {
		if (!preg_match('#^(https?)://([^/:]+|\[[0-9a-fA-F:]+\])(?::(\d+))?$#', rtrim($base, '/'), $m)) {
			throw new \InvalidArgumentException('Not a valid address');
		}
		[$all, $scheme, $host, $port] = array_pad($m, 4, '');
		$host = trim($host, '[]');
		$this->tools->validateHost($host);
		if ($port !== '' && ((int)$port < 1 || (int)$port > 65535)) {
			throw new \InvalidArgumentException('Not a valid port');
		}

		$address = filter_var($host, FILTER_VALIDATE_IP) !== false ? $host : (string)@gethostbyname($host);
		if ($address === '' || filter_var($address, FILTER_VALIDATE_IP) === false) {
			throw new \InvalidArgumentException('That name does not resolve');
		}
		if (!$this->isLocal($address) && $this->devices->findByIp($address) === null) {
			throw new \RuntimeException('NetBase only opens devices on this server\'s own networks. That address is neither local nor in the device list.');
		}
		return $scheme . '://' . $host . ($port !== '' ? ':' . $port : '');
	}

	private function isLocal(string $address): bool {
		if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
			// Private, loopback and link-local addresses fail that filter, which
			// is exactly the set we want to allow.
			return true;
		}
		// A public address still counts as local when it is one of this
		// server's own, or sits inside a network it is attached to.
		foreach ($this->discovery->interfaces() as $interface) {
			foreach ($interface['addresses'] ?? [] as $own) {
				if (($own['ip'] ?? '') === $address) {
					return true;
				}
			}
		}
		return false;
	}

	// ------------------------------------------------------------------ passwords

	/** Keep what the device asked for, for as long as the window may live. */
	public function rememberAuth(string $base, string $userId, string $user, string $password): void {
		$header = 'Basic ' . base64_encode($user . ':' . $password);
		@file_put_contents($this->authFile($userId, $base), $this->crypto->encrypt($header), LOCK_EX);
		@chmod($this->authFile($userId, $base), 0600);
	}

	public function forgetAuth(string $base, string $userId): void {
		@unlink($this->authFile($userId, $base));
	}

	private function recallAuth(string $base, string $userId): string {
		$file = $this->authFile($userId, $base);
		if (!is_readable($file)) {
			return '';
		}
		try {
			return (string)$this->crypto->decrypt((string)file_get_contents($file));
		} catch (\Throwable $e) {
			@unlink($file);
			return '';
		}
	}

	private function authFile(string $userId, string $base): string {
		return $this->stateDir() . '/' . sha1($userId . '|' . $base) . '.auth';
	}

	/** What the device calls the thing it is guarding. */
	private function realm(string $challenge): string {
		if (preg_match('#realm\s*=\s*"([^"]*)"#i', $challenge, $m) === 1) {
			return mb_substr($m[1], 0, 120);
		}
		return '';
	}

	// ------------------------------------------------------------------ cookies

	/**
	 * The device's own session, kept for one person and one device.
	 *
	 * A page's frames are fetched all at once, so several requests write here
	 * within the same instant; each keeps what it learnt and leaves the rest
	 * alone, rather than replacing the lot with its own view.
	 *
	 * @return list<string> cookies in the tab-separated form curl speaks
	 */
	private function loadCookies(string $userId, string $base): array {
		$file = $this->cookieFile($userId, $base);
		if (!is_readable($file)) {
			return [];
		}
		$lines = preg_split('/\R/', (string)file_get_contents($file)) ?: [];
		return array_values(array_filter($lines, static fn (string $line) => trim($line) !== ''));
	}

	/** @param array<int, string> $cookies */
	private function saveCookies(string $userId, string $base, array $cookies): void {
		if ($cookies === []) {
			return;
		}
		$file = $this->cookieFile($userId, $base);
		$handle = @fopen($file, 'c+');
		if ($handle === false) {
			return;
		}
		try {
			if (!flock($handle, LOCK_EX)) {
				return;
			}
			$known = [];
			foreach (preg_split('/\R/', (string)stream_get_contents($handle)) ?: [] as $line) {
				$key = self::cookieKey($line);
				if ($key !== '') {
					$known[$key] = $line;
				}
			}
			foreach ($cookies as $line) {
				$key = self::cookieKey((string)$line);
				if ($key !== '') {
					$known[$key] = (string)$line;
				}
			}
			ftruncate($handle, 0);
			rewind($handle);
			fwrite($handle, implode("\n", array_slice($known, -100)) . "\n");
			fflush($handle);
			@chmod($file, 0600);
		} finally {
			flock($handle, LOCK_UN);
			fclose($handle);
		}
	}

	/** Domain, path and name together identify one cookie. */
	private static function cookieKey(string $line): string {
		$line = trim($line);
		if ($line === '' || (str_starts_with($line, '#') && !str_starts_with($line, '#HttpOnly_'))) {
			return '';
		}
		$parts = explode("\t", $line);
		if (count($parts) < 6) {
			return '';
		}
		return $parts[0] . '|' . $parts[2] . '|' . $parts[5];
	}

	private function cookieFile(string $userId, string $base): string {
		return $this->stateDir() . '/' . sha1($userId . '|' . $base) . '.cookies';
	}

	private function stateDir(): string {
		$dir = sys_get_temp_dir() . '/netbase-proxy';
		if (!is_dir($dir)) {
			@mkdir($dir, 0700, true);
		}
		return $dir;
	}

	// ------------------------------------------------------------------ rewriting

	/** Everything the page points at has to come back through this server. */
	private function rewriteHtml(string $body, string $base, string $prefix, string $path): string {
		$body = preg_replace('#<base\b[^>]*>#i', '', $body) ?? $body;

		// Absolute paths would otherwise hit Nextcloud itself.
		$body = preg_replace_callback(
			'#\b(href|src|action|data-src|poster)\s*=\s*(["\'])(/[^"\']*)\2#i',
			static fn (array $m) => $m[1] . '=' . $m[2] . $prefix . $m[3] . $m[2],
			$body,
		) ?? $body;

		// Absolute URLs that point back at the same device.
		$quoted = preg_quote($base, '#');
		$body = preg_replace('#(["\'(])' . $quoted . '(/[^"\')]*)?#i', '$1' . $prefix . '$2', $body) ?? $body;

		// A device page often aims its links at the whole browser window — the
		// frameset habit of _top and _parent, which on the device means "replace
		// everything". Inside NetBase that would mean walking out of the app, and
		// _self would trap the page in whichever small frame the link sat in. Both
		// are wrong: what the device means by "everything" is this window, which
		// carries that name.
		$body = preg_replace('#\btarget\s*=\s*(["\'])\s*_(top|parent|blank)\s*\1#i', 'target="' . self::WINDOW_NAME . '"', $body) ?? $body;
		$body = preg_replace('#\btarget\s*=\s*_(top|parent|blank)(?=[\s>])#i', 'target=' . self::WINDOW_NAME, $body) ?? $body;

		// A page that forwards itself with a meta refresh is common on routers
		// and printers, and the address inside it needs the same treatment.
		$body = preg_replace_callback(
			'#(<meta[^>]*http-equiv\s*=\s*["\']?refresh["\']?[^>]*content\s*=\s*["\'])([^"\']*)#i',
			function (array $m) use ($base, $prefix, $path) {
				return $m[1] . preg_replace_callback(
					'#(url\s*=\s*)(\S+)#i',
					fn (array $u) => $u[1] . $this->rewriteUrl(trim($u[2], '\'"'), $base, $prefix, $path),
					$m[2],
				);
			},
			$body,
		) ?? $body;

		$body = $this->rewriteCss($body, $prefix);

		// Rewriting the markup cannot catch an address a script builds while the
		// page runs, so the page is given a small shim that redirects those the
		// same way. Without it, a device interface that fetches its own data
		// would reach for Nextcloud's root instead.
		$shim = $this->shim($prefix);
		// After the character set declaration, so it stays where the browser
		// looks for it, and before anything the page runs itself.
		if (preg_match('#<meta[^>]*charset[^>]*>#i', $body, $m, PREG_OFFSET_CAPTURE) === 1) {
			$at = $m[0][1] + strlen($m[0][0]);
			$body = substr($body, 0, $at) . $shim . substr($body, $at);
		} elseif (preg_match('#<head[^>]*>#i', $body) === 1) {
			$body = preg_replace('#(<head[^>]*>)#i', '$1' . $shim, $body, 1) ?? $body;
		} else {
			$body = $shim . $body;
		}
		return $body;
	}

	/** Sends script-made requests back through the proxy instead of to Nextcloud. */
	private function shim(string $prefix): string {
		$script = <<<'JS'
(function () {
	var P = __PREFIX__;
	function fix(u) {
		if (typeof u !== 'string' || !u) { return u; }
		if (u.charAt(0) !== '/' || u.charAt(1) === '/') { return u; }
		if (u.lastIndexOf(P, 0) === 0) { return u; }
		return P + u;
	}
	var escapes = { _top: 1, _parent: 1, _blank: 1 };
	var W = __WINDOW__;
	function fixMarkup(html) {
		return String(html).replace(/(\b(?:src|href|action|data|poster)\s*=\s*["'])\/(?!\/)/gi, '$1' + P + '/');
	}
	var of = window.fetch;
	if (of) {
		window.fetch = function (i, o) {
			if (typeof i === 'string') { i = fix(i); }
			else if (i && i.url) { i = new Request(fix(i.url), i); }
			return of.call(this, i, o);
		};
	}
	var oo = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function () {
		var a = [].slice.call(arguments);
		a[1] = fix(a[1]);
		return oo.apply(this, a);
	};
	var ow = window.open;
	window.open = function () {
		var a = [].slice.call(arguments);
		a[0] = fix(a[0]);
		if (a[1] && escapes[String(a[1]).toLowerCase()]) { a[1] = W; }
		return ow.apply(this, a);
	};
	// Old device interfaces build themselves with document.write, and the
	// scripts they pull in that way start loading before anything can watch
	// the DOM — so the markup is corrected on the way in.
	['write', 'writeln'].forEach(function (name) {
		var original = document[name];
		document[name] = function () {
			return original.apply(document, [].map.call(arguments, fixMarkup));
		};
	});
	// An address assigned to an element in script never passes through the
	// markup at all, so the properties themselves are corrected.
	[[HTMLScriptElement, 'src'], [HTMLImageElement, 'src'], [HTMLIFrameElement, 'src'],
		[HTMLLinkElement, 'href'], [HTMLAnchorElement, 'href'], [HTMLFormElement, 'action'],
		[HTMLSourceElement, 'src'], [HTMLMediaElement, 'src']].forEach(function (pair) {
		var type = pair[0];
		if (!type) { return; }
		var name = pair[1];
		var descriptor = Object.getOwnPropertyDescriptor(type.prototype, name);
		if (!descriptor || !descriptor.set) { return; }
		Object.defineProperty(type.prototype, name, {
			configurable: true,
			enumerable: descriptor.enumerable,
			get: descriptor.get,
			set: function (value) { descriptor.set.call(this, fix(value)); }
		});
	});
	var attributes = ['src', 'href', 'action', 'data', 'poster', 'target'];
	function scrub(node) {
		if (!node || node.nodeType !== 1 || !node.getAttribute) { return; }
		for (var i = 0; i < attributes.length; i++) {
			var name = attributes[i];
			var value = node.getAttribute(name);
			if (!value) { continue; }
			if (name === 'target') {
				// Anything aimed outside the window is aimed at the window.
				if (escapes[value.toLowerCase()]) { node.setAttribute(name, W); }
				continue;
			}
			if (value !== fix(value)) { node.setAttribute(name, fix(value)); }
		}
	}
	function sweep(root) {
		scrub(root);
		if (root.querySelectorAll) {
			var found = root.querySelectorAll('[src],[href],[action],[data],[poster],[target]');
			for (var i = 0; i < found.length; i++) { scrub(found[i]); }
		}
	}
	if (window.MutationObserver) {
		new MutationObserver(function (records) {
			for (var i = 0; i < records.length; i++) {
				var record = records[i];
				if (record.type === 'attributes') { scrub(record.target); continue; }
				for (var j = 0; j < record.addedNodes.length; j++) { sweep(record.addedNodes[j]); }
			}
		}).observe(document.documentElement, {
			childList: true, subtree: true, attributes: true, attributeFilter: attributes
		});
	}
	document.addEventListener('submit', function (event) { scrub(event.target); }, true);

	// "Replace everything" means this window, not the browser.
	//
	// A device page built out of frames aims its menu at _top. The window is
	// sandboxed so that a page cannot navigate the browser, and that same fence
	// stops a frame inside it from navigating the window's own document — the
	// browser would open a new tab instead. So the document navigates itself,
	// on behalf of whichever of its frames asked: the call runs here, in the
	// window's own document, which is allowed to go where it likes.
	window.__netbaseGo = function (href) { location.href = href; };
	window.__netbaseSubmit = function (action, method, fields) {
		var form = document.createElement('form');
		form.action = action;
		form.method = method || 'get';
		for (var i = 0; i < fields.length; i++) {
			var input = document.createElement('input');
			input.type = 'hidden';
			input.name = fields[i][0];
			input.value = fields[i][1];
			form.appendChild(input);
		}
		(document.body || document.documentElement).appendChild(form);
		form.submit();
	};
	function windowRoot() {
		var w = window;
		try {
			while (w.parent && w.parent !== w && w.parent.location.pathname.lastIndexOf(P, 0) === 0) { w = w.parent; }
		} catch (e) { /* a document we may not read is not one of ours */ }
		return w;
	}
	document.addEventListener('click', function (event) {
		var link = event.target && event.target.closest ? event.target.closest('a[target]') : null;
		if (!link || link.getAttribute('target') !== W || !link.href) { return; }
		var root = windowRoot();
		event.preventDefault();
		if (root === window || typeof root.__netbaseGo !== 'function') { location.href = link.href; return; }
		root.__netbaseGo(link.href);
	}, true);
	document.addEventListener('submit', function (event) {
		var form = event.target;
		if (!form || form.getAttribute('target') !== W) { return; }
		var root = windowRoot();
		if (root === window || typeof root.__netbaseSubmit !== 'function') {
			form.setAttribute('target', '_self');
			return;
		}
		event.preventDefault();
		var fields = [];
		for (var i = 0; i < form.elements.length; i++) {
			var el = form.elements[i];
			if (!el.name || el.disabled) { continue; }
			if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) { continue; }
			fields.push([el.name, el.value]);
		}
		root.__netbaseSubmit(form.action, form.method, fields);
	}, true);
	// A page built out of frames cannot load them while the window has no
	// origin of its own — the browser refuses, and there is no policy that
	// permits it. NetBase is told, so it can offer the way round.
	function tell() {
		// Where the window is now, so NetBase can show it and come back to it.
		try {
			window.parent.postMessage({
				netbase: document.querySelector('frameset, frame') ? 'frames' : 'here',
				href: location.pathname + location.search,
				title: document.title || ''
			}, '*');
		} catch (e) {}
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', tell);
	} else {
		tell();
	}
	setTimeout(tell, 1500);
})();
JS;
		$script = str_replace('__PREFIX__', json_encode($prefix, JSON_UNESCAPED_SLASHES), $script);
		$script = str_replace('__WINDOW__', json_encode(self::WINDOW_NAME), $script);
		return '<script>' . $script . '</script>';
	}

	private function rewriteCss(string $body, string $prefix): string {
		return preg_replace('#url\(\s*(["\']?)/(?!/)#i', 'url($1' . $prefix . '/', $body) ?? $body;
	}

	private function rewriteUrl(string $url, string $base, string $prefix, string $path): string {
		if (str_starts_with($url, $base)) {
			return $prefix . substr($url, strlen($base));
		}
		if (str_starts_with($url, '/')) {
			return $prefix . $url;
		}
		return $url;
	}
}
