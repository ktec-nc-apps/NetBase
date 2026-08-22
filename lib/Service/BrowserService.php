<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\ITempManager;
use Psr\Log\LoggerInterface;

/**
 * A picture of a device's own web page.
 *
 * A link tells you a port answers; a picture tells you what the thing is. When
 * a headless Chromium is installed, NetBase drives it once, from this server,
 * and hands the browser a PNG — which also means the page can be seen from
 * outside the LAN, where opening the link itself would not work.
 *
 * The browser runs with a throwaway profile in a temporary directory that is
 * deleted afterwards, so nothing about the visited page survives the request.
 */
class BrowserService {
	private const BINARIES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'];
	private const MAX_BYTES = 8388608;

	public function __construct(
		private ExecService $exec,
		private ToolService $tools,
		private ITempManager $tempManager,
		private LoggerInterface $logger,
	) {
	}

	/** The headless browser this server has, if it has one. */
	public function binary(): ?string {
		foreach (self::BINARIES as $candidate) {
			$path = $this->exec->which($candidate);
			if ($path !== null) {
				return $candidate;
			}
		}
		return null;
	}

	public function available(): bool {
		return $this->binary() !== null;
	}

	/**
	 * Render one page and return the PNG.
	 *
	 * @return array{ok: bool, image: string, seconds: float, url: string, error: ?string, width: int, height: int}
	 */
	public function screenshot(string $url, int $width = 1280, int $height = 900, int $waitMs = 4000, bool $fullPage = false): array {
		$url = $this->validateUrl($url);
		$width = max(320, min(2560, $width));
		$height = max(240, min(2000, $height));
		$waitMs = max(500, min(15000, $waitMs));

		$binary = $this->binary();
		if ($binary === null) {
			return ['ok' => false, 'image' => '', 'seconds' => 0.0, 'url' => $url, 'error' => 'No headless browser is installed on this server', 'width' => $width, 'height' => $height];
		}

		$dir = $this->tempManager->getTemporaryFolder('netbase-shot');
		if ($dir === false) {
			return ['ok' => false, 'image' => '', 'seconds' => 0.0, 'url' => $url, 'error' => 'No writable temporary directory', 'width' => $width, 'height' => $height];
		}
		$shot = rtrim($dir, '/') . '/page.png';
		$profile = rtrim($dir, '/') . '/profile';
		@mkdir($profile, 0700, true);

		$args = [
			'--headless',
			'--disable-gpu',
			// Chromium's sandbox needs privileges PHP does not have; the page is
			// rendered in a throwaway profile that is deleted straight after.
			'--no-sandbox',
			'--disable-dev-shm-usage',
			'--disable-crash-reporter',
			'--disable-extensions',
			'--disable-background-networking',
			'--no-first-run',
			'--no-default-browser-check',
			'--hide-scrollbars',
			'--force-device-scale-factor=1',
			// Device web interfaces almost always have a self-signed certificate.
			'--ignore-certificate-errors',
			'--user-data-dir=' . $profile,
			'--window-size=' . $width . ',' . $height,
			'--virtual-time-budget=' . $waitMs,
			'--screenshot=' . $shot,
		];
		if ($fullPage) {
			$args[] = '--screenshot-full-page';
		}
		$args[] = $url;

		$started = microtime(true);
		$result = $this->exec->run($binary, $args, ($waitMs / 1000) + 20.0, 65536, [
			// Chromium writes its profile and caches under HOME and refuses to
			// start when that is not writable, which it is not for the web user.
			'HOME' => $dir,
			'XDG_CONFIG_HOME' => $dir,
			'XDG_CACHE_HOME' => $dir,
		]);
		$seconds = round(microtime(true) - $started, 2);

		$image = '';
		if (is_readable($shot) && filesize($shot) > 0 && filesize($shot) <= self::MAX_BYTES) {
			$image = (string)file_get_contents($shot);
		}
		$this->cleanup($dir);

		if ($image === '') {
			$this->logger->info('NetBase: page render produced no image', ['url' => $url, 'stderr' => mb_substr($result['stderr'], -400)]);
			return ['ok' => false, 'image' => '', 'seconds' => $seconds, 'url' => $url, 'error' => 'The page could not be rendered. It may not have answered in time.', 'width' => $width, 'height' => $height];
		}
		return ['ok' => true, 'image' => $image, 'seconds' => $seconds, 'url' => $url, 'error' => null, 'width' => $width, 'height' => $height];
	}

	private function validateUrl(string $url): string {
		$url = trim($url);
		if (!preg_match('#^https?://#i', $url)) {
			$url = 'http://' . $url;
		}
		$parts = parse_url($url);
		if ($parts === false || empty($parts['host'])) {
			throw new \InvalidArgumentException('Not a valid address');
		}
		if (!in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true)) {
			throw new \InvalidArgumentException('Only http and https pages can be shown');
		}
		$this->tools->validateHost(trim($parts['host'], '[]'));
		$port = (int)($parts['port'] ?? 0);
		if ($port < 0 || $port > 65535) {
			throw new \InvalidArgumentException('Not a valid port');
		}
		return $url;
	}

	private function cleanup(string $dir): void {
		if (!is_dir($dir)) {
			return;
		}
		$items = new \RecursiveIteratorIterator(
			new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
			\RecursiveIteratorIterator::CHILD_FIRST,
		);
		foreach ($items as $item) {
			$item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
		}
		@rmdir($dir);
	}
}
