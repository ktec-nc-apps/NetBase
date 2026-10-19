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
			$language = Application::OLD_LANGUAGES[$language] ?? $language; // shipped as "pt" and "zh" until 2026-10
			$this->l = $this->factory->get(Application::APP_ID, $language === 'auto' ? null : $language);
		}
		return $this->l;
	}

	/** @param array<int, string|int|float> $parameters */
	public function t(string $text, array $parameters = []): string {
		return $this->get()->t($text, $parameters);
	}

	/** An error's message in the reader's own language (see wordsOf). */
	public function said(\Throwable $e): string {
		return self::wordsOf($this->get(), $e);
	}

	/**
	 * An error's message, translated.
	 *
	 * Errors are raised deep in the services as plain English, the source
	 * language of everything else in NetBase too, and translated where they
	 * leave for the screen. A message with no translation comes back as it was
	 * written: the server's own reply, an operating system's error.
	 */
	public static function wordsOf(IL10N $l, \Throwable $e): string {
		$message = $e->getMessage();
		if ($message === '') {
			return $message;
		}
		// A sentence with values in it is looked up without them, and each value
		// is looked up too: a label such as "Mail accounts" is a sentence of its
		// own, while a host or a server's reply simply comes back unchanged.
		if ($e instanceof Worded) {
			$args = array_map(static fn ($a) => is_string($a) && $a !== '' ? $l->t(str_replace('%', '%%', $a)) : $a, $e->args());
			return $l->t($e->text(), $args);
		}
		// Nextcloud runs every translated string through vsprintf, even when no
		// parameters were given. A message that already carries a value — a path,
		// a host, a percentage — can therefore contain a stray "%" that vsprintf
		// would choke on. Doubling it makes vsprintf hand back the single "%" it
		// started with, and the plain messages this is really here for contain no
		// "%" at all, so their lookup is unaffected.
		return $l->t(str_replace('%', '%%', $message));
	}
}
