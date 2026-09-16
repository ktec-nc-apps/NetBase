<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\IConfig;
use OCP\ISession;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Mail\IMailer;
use Psr\Log\LoggerInterface;

/**
 * The gate in front of the local shell.
 *
 * A shell on the server is the most powerful thing NetBase can offer, so it is
 * never opened on the strength of a page request alone. Two things stand in
 * front of it:
 *
 *  * only an administrator may ask for it (enforced by the controller), and
 *  * on an instance that can reach the internet, the administrator must prove
 *    they hold the account's mailbox: a six-digit code is sent there and has
 *    to be typed back before the shell will open.
 *
 * On a closed network — one that cannot reach the internet at all — there is
 * nowhere for a stolen session to be driven from, and often no mail server to
 * send a code through, so the shell opens directly. When the instance is
 * online but the administrator has no email address on file, nothing is sent
 * and the caller is told to set one first.
 *
 * The code and the "you have passed the gate" ticket live in the server-side
 * session only; neither is ever returned to the browser.
 */
class ShellGateService {
	/** How long a sent code stays valid, in seconds. */
	private const CODE_TTL = 600;

	/** Wrong guesses allowed before the code is thrown away. */
	private const MAX_ATTEMPTS = 5;

	/** How long a passed gate lets the shell be (re)opened, in seconds. */
	private const TICKET_TTL = 900;

	/** Well-known addresses, used to tell a closed network from an open one. */
	private const REACH_TCP = [['1.1.1.1', 443], ['8.8.8.8', 443], ['9.9.9.9', 443]];
	private const REACH_DNS = ['1.1.1.1', '8.8.8.8'];
	private const REACH_NTP = ['216.239.35.0', '162.159.200.1', '133.243.238.243'];

	/** How long any single check may take. */
	private const REACH_TIMEOUT = 1.2;

	private const K_CODE = 'netbase_shell_code';
	private const K_EXPIRES = 'netbase_shell_expires';
	private const K_ATTEMPTS = 'netbase_shell_attempts';
	private const K_TICKET = 'netbase_shell_ticket';
	private const K_ROUTE = 'netbase_shell_route';

	public function __construct(
		private IUserSession $userSession,
		private IMailer $mailer,
		// Used by the closed-network check.
		private ProbeService $probe,
		private DnsService $dns,
		private ISession $session,
		private IConfig $config,
		private IURLGenerator $urls,
		// NetBase can be set to a different language from the rest of
		// Nextcloud, per account, and this message is NetBase's — so it
		// follows that setting rather than the account's own language.
		private L10nService $l10n,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Decide what has to happen before the shell can open, and set it in motion.
	 *
	 * @return array{mode: string, email?: string}
	 */
	public function begin(): array {
		if ($this->isClosedNetwork()) {
			$this->clearCode();
			$this->issueTicket('closed');
			return ['mode' => 'open'];
		}
		$email = $this->adminEmail();
		if ($email === '') {
			return ['mode' => 'no-email'];
		}
		$code = $this->makeCode();
		$this->session->set(self::K_CODE, hash('sha256', $code));
		$this->session->set(self::K_EXPIRES, time() + self::CODE_TTL);
		$this->session->set(self::K_ATTEMPTS, 0);
		try {
			$this->sendCode($email, $code);
		} catch (\Throwable $e) {
			$this->logger->error('NetBase: could not send the shell code', ['exception' => $e, 'app' => 'netbase']);
			$this->clearCode();
			return ['mode' => 'mail-failed'];
		}
		return ['mode' => 'verify', 'email' => $this->mask($email)];
	}

	/**
	 * Check a typed code and, if it is right, open the gate.
	 *
	 * @return array{ok: bool, error?: string, remaining?: int}
	 */
	public function verify(string $code): array {
		$stored = $this->session->get(self::K_CODE);
		$expires = (int)$this->session->get(self::K_EXPIRES);
		$attempts = (int)$this->session->get(self::K_ATTEMPTS);
		$code = trim($code);

		if (!is_string($stored) || $stored === '' || $expires < time()) {
			$this->clearCode();
			return ['ok' => false, 'error' => 'expired'];
		}
		if (preg_match('/^\d{6}$/', $code) === 1 && hash_equals($stored, hash('sha256', $code))) {
			$this->clearCode();
			$this->issueTicket('code');
			return ['ok' => true];
		}
		$attempts++;
		$this->session->set(self::K_ATTEMPTS, $attempts);
		$remaining = self::MAX_ATTEMPTS - $attempts;
		if ($remaining <= 0) {
			$this->clearCode();
			return ['ok' => false, 'error' => 'too-many'];
		}
		return ['ok' => false, 'error' => 'wrong', 'remaining' => $remaining];
	}

	/** Whether the gate has been passed and the shell may be opened now. */
	public function hasTicket(): bool {
		return (int)$this->session->get(self::K_TICKET) > time();
	}

	/**
	 * How the gate was passed: 'closed' for a network that could not reach out,
	 * 'code' for a verified email code. Recorded so that opening a shell can be
	 * logged with the reason it was allowed.
	 */
	public function route(): string {
		$route = $this->session->get(self::K_ROUTE);
		return is_string($route) ? $route : 'unknown';
	}

	/**
	 * Is this instance on a closed network?
	 *
	 * Several independent checks are made against well-known addresses. A
	 * single one getting through settles it: the instance can reach outside,
	 * so a code is required. Only when none of them does is the network
	 * treated as closed.
	 */
	public function isClosedNetwork(): bool {
		$asked = false;

		foreach (self::REACH_TCP as [$host, $port]) {
			$errno = 0;
			$errstr = '';
			$fp = @fsockopen($host, $port, $errno, $errstr, self::REACH_TIMEOUT);
			$asked = true;
			if ($fp !== false) {
				fclose($fp);
				return false;
			}
		}

		foreach (self::REACH_DNS as $resolver) {
			try {
				$answer = $this->dns->query('a.root-servers.net', 'A', $resolver, false, self::REACH_TIMEOUT);
				$asked = true;
				if (empty($answer['error']) && !empty($answer['answers'])) {
					return false;
				}
			} catch (\Throwable $e) {
				$this->logger->debug('NetBase: the DNS reachability probe could not run', ['exception' => $e]);
			}
		}

		foreach (self::REACH_NTP as $server) {
			try {
				$answer = $this->probe->ntp($server, self::REACH_TIMEOUT);
				$asked = true;
				if (!empty($answer['ok'])) {
					return false;
				}
			} catch (\Throwable $e) {
				$this->logger->debug('NetBase: the NTP reachability probe could not run', ['exception' => $e]);
			}
		}

		// Nothing answered. If nothing could even be asked, treat the network as
		// open: requiring a code is the safe answer to a question left unput.
		return $asked;
	}

	/** The signed-in administrator's own email address, or '' if none is set. */
	public function adminEmail(): string {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return '';
		}
		return trim((string)$user->getEMailAddress());
	}

	private function issueTicket(string $route = 'unknown'): void {
		$this->session->set(self::K_TICKET, time() + self::TICKET_TTL);
		$this->session->set(self::K_ROUTE, $route);
	}

	private function clearCode(): void {
		$this->session->remove(self::K_CODE);
		$this->session->remove(self::K_EXPIRES);
		$this->session->remove(self::K_ATTEMPTS);
	}

	private function makeCode(): string {
		return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
	}

	private function sendCode(string $email, string $code): void {
		$where = $this->urls->getBaseUrl();
		$name = $this->config->getAppValue('theming', 'name', 'Nextcloud');
		$subject = $this->l10n->t('%s — code to open a shell', [$name]);
		$body = $this->l10n->t('Someone asked to open a server shell in NetBase on %1$s.', [$where]) . "\n\n"
			. $this->l10n->t('Your verification code is: %s', [$code]) . "\n\n"
			. $this->l10n->t('The code is valid for %d minutes. If this was not you, you can ignore this message — no shell is opened without this code.', [(int)(self::CODE_TTL / 60)]);

		$message = $this->mailer->createMessage();
		$message->setSubject($subject);
		$message->setTo([$email]);
		$message->setPlainBody($body);
		$this->mailer->send($message);
	}

	/** a***@example.com — enough to recognise the address, not to read it out. */
	private function mask(string $email): string {
		$at = strpos($email, '@');
		if ($at === false || $at === 0) {
			return $email;
		}
		$local = substr($email, 0, $at);
		$domain = substr($email, $at);
		$head = mb_substr($local, 0, 1);
		return $head . str_repeat('*', max(1, mb_strlen($local) - 1)) . $domain;
	}
}
