<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCA\NetBase\Db\TermLogEntity;
use OCA\NetBase\Db\TermLogMapper;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * A record of what was done in a terminal.
 *
 * A shell on this server and an SSH window are the two places in NetBase where
 * something is done rather than merely looked at, and once the window is closed
 * there is otherwise nothing left to show for it. This keeps the work: one step
 * is a line that was typed together with whatever came back before the next
 * line was typed, which is the smallest piece anyone would want to read back.
 *
 * It is off until it is turned on, and while it is off nothing is written at
 * all — no table row, no file, no cost. Turning it on is a switch of its own,
 * so the number beside it can carry a sensible figure from the start instead of
 * a zero that reads like a setting somebody forgot to fill in.
 *
 * Two limits then keep it from growing without end:
 *
 *  - a number of steps, per session: the oldest are dropped as new ones arrive;
 *  - a number of days, counted from a session's most recent step: a window
 *    still being used is never cut short, and one finished with goes as a
 *    whole rather than being eaten away from the front.
 *
 * A step is assembled across three separate requests — the one streaming the
 * terminal, and each of the ones carrying a keystroke — so the half-built step
 * cannot live in memory. It waits in a small directory of its own, next to but
 * deliberately not inside the one the terminal itself uses, so that terminal
 * closing down does not take a half-written step with it.
 */
class TermLogService {
	/** The most of one step's output that is worth keeping, in bytes. */
	private const MAX_SAID = 65536;

	/** The most of one typed line that is worth keeping, in bytes. */
	private const MAX_TYPED = 4096;

	/** Steps per session, ceiling. A setting above this is brought down to it. */
	private const MAX_STEPS = 10000;

	/** What the number starts at once recording is switched on. */
	private const DEFAULT_STEPS = 5000;

	/** Days, ceiling. */
	private const MAX_DAYS = 3650;

	public function __construct(
		private TermLogMapper $mapper,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * How many steps this account keeps per session; 0 means record nothing.
	 *
	 * Whether to record at all is its own switch, off until somebody turns it
	 * on. The number beside it is what to keep once it is on, and it has a
	 * sensible figure from the start rather than a zero that reads like a
	 * setting somebody forgot to fill in.
	 */
	public function keepSteps(string $userId): int {
		if ($this->config->getUserValue($userId, 'netbase', 'term_log_on', '0') !== '1') {
			return 0;
		}
		$n = (int)$this->config->getUserValue($userId, 'netbase', 'term_log_steps', (string)self::DEFAULT_STEPS);
		return max(1, min(self::MAX_STEPS, $n));
	}

	/** How many days after a session's last step before it is dropped. */
	public function keepDays(string $userId): int {
		$n = (int)$this->config->getUserValue($userId, 'netbase', 'term_log_days', '30');
		return max(1, min(self::MAX_DAYS, $n));
	}

	/** Whether anything at all should be written for this account. */
	public function enabled(string $userId): bool {
		return $this->keepSteps($userId) > 0;
	}

	/**
	 * A terminal is opening.
	 *
	 * Called while the request can still read settings — the streaming request
	 * closes its session immediately afterwards — so what is decided here is
	 * written down and not asked again.
	 */
	public function begin(string $userId, string $session, string $kind, string $target): void {
		if (!$this->enabled($userId)) {
			return;
		}
		$dir = $this->dir($userId, $session, true);
		if ($dir === '') {
			return;
		}
		@file_put_contents($dir . '/meta', (string)json_encode([
			'kind' => $kind,
			'target' => mb_substr($target, 0, 255),
			'keep' => $this->keepSteps($userId),
			'step' => 0,
		]), LOCK_EX);
	}

	/**
	 * Something the terminal said. Appended to the step being built.
	 *
	 * Called for every chunk of a live terminal, so it does as little as it
	 * can: when there is no session directory — which is the case whenever
	 * recording is off — it is one failed stat and nothing more.
	 */
	public function said(string $userId, string $session, string $chunk): void {
		if ($chunk === '') {
			return;
		}
		$dir = $this->dir($userId, $session, false);
		if ($dir === '' || !is_file($dir . '/meta')) {
			return;
		}
		$out = $dir . '/said';
		// Past the cap the rest is dropped rather than buffered: a command that
		// prints a hundred megabytes should not be able to fill the disk on its
		// way to being truncated anyway.
		if ((int)@filesize($out) > self::MAX_SAID) {
			return;
		}
		@file_put_contents($out, $chunk, FILE_APPEND | LOCK_EX);
	}

	/**
	 * Something was typed.
	 *
	 * Return does not close a step: it opens one. What a command has to say
	 * arrives after the Return that sent it, so the line is set aside and the
	 * step is written when the *next* Return comes — by which time the answer
	 * has been gathered. Anything else typed is held: a step is a line, not a
	 * keystroke.
	 */
	public function typed(string $userId, string $session, string $data): void {
		if ($data === '') {
			return;
		}
		$dir = $this->dir($userId, $session, false);
		if ($dir === '' || !is_file($dir . '/meta')) {
			return;
		}
		$line = $dir . '/typed';
		if ((int)@filesize($line) <= self::MAX_TYPED) {
			@file_put_contents($line, $data, FILE_APPEND | LOCK_EX);
		}
		if (strpbrk($data, "\r\n") !== false) {
			$this->flush($userId, $session, $dir);
		}
	}

	/**
	 * The terminal has closed. Anything still being gathered is kept — a
	 * command that was running when the window went is exactly the one someone
	 * will want to look at — and the working files go.
	 */
	public function finish(string $userId, string $session): void {
		$dir = $this->dir($userId, $session, false);
		if ($dir === '' || !is_file($dir . '/meta')) {
			return;
		}
		$this->flush($userId, $session, $dir, true);
		foreach (['meta', 'typed', 'said'] as $name) {
			@unlink($dir . '/' . $name);
		}
		@rmdir($dir);
	}

	/**
	 * The sessions this account has recorded.
	 *
	 * @return list<array{session: string, kind: string, target: string, steps: int, first: int, last: int}>
	 */
	public function sessions(string $userId): array {
		return $this->mapper->sessions($userId);
	}

	/**
	 * One session, step by step.
	 *
	 * @return list<array<string, mixed>>
	 */
	public function read(string $userId, string $session): array {
		$out = [];
		foreach ($this->mapper->steps($userId, $session) as $entity) {
			$out[] = $entity->jsonSerialize();
		}
		return $out;
	}

	/** Throw one session away, or everything this account has. */
	public function forget(string $userId, string $session = ''): int {
		return $session === ''
			? $this->mapper->dropForUser($userId)
			: $this->mapper->dropSession($userId, $session);
	}

	/**
	 * Drop the sessions that have gone quiet for longer than their owner keeps
	 * them. Run from the tidying job; safe to run at any time.
	 */
	public function tidy(): int {
		$now = time();
		$days = [];
		$gone = 0;
		foreach ($this->mapper->lastWritten() as $row) {
			$user = $row['user'];
			if ($user === '') {
				continue;
			}
			// One settings read per account, however many sessions it has.
			$days[$user] ??= $this->keepDays($user);
			if ($row['last'] > 0 && $row['last'] < $now - ($days[$user] * 86400)) {
				$gone += $this->mapper->dropSession($user, $row['session']);
			}
		}
		return $gone;
	}

	/**
	 * A Return has arrived, or the window has closed.
	 *
	 * The line just sent cannot be written yet — its answer has not come back.
	 * So the line waiting from last time is written together with everything
	 * said since, and this new line takes its place. On closing there is no
	 * next Return to wait for, so whatever is left is written as it stands.
	 */
	private function flush(string $userId, string $session, string $dir, bool $closing = false): void {
		$meta = json_decode((string)@file_get_contents($dir . '/meta'), true);
		if (!is_array($meta)) {
			return;
		}
		$line = $this->take($dir . '/typed');
		$said = $this->take($dir . '/said');

		if (!array_key_exists('pending', $meta)) {
			// Nothing has been sent yet, so anything the terminal has said is
			// its greeting. It is put back to arrive with the first command
			// rather than being written as a step with nothing that caused it.
			if ($said !== '' && !$closing) {
				@file_put_contents($dir . '/said', $said, FILE_APPEND | LOCK_EX);
				$said = '';
			}
		} else {
			$this->write($userId, $session, $meta, (string)$meta['pending'], $said);
			$said = '';
		}

		if ($closing) {
			unset($meta['pending']);
			// A command typed but never sent, or a last answer with nothing
			// after it, is exactly what somebody would come looking for.
			if (trim($line) !== '' || trim($said) !== '') {
				$this->write($userId, $session, $meta, $line, $said);
			}
		} else {
			$meta['pending'] = $line;
		}
		@file_put_contents($dir . '/meta', (string)json_encode($meta), LOCK_EX);
	}

	/**
	 * One step into the table, and the oldest dropped if there are now too many.
	 *
	 * $meta is carried by reference because the step number lives in it and has
	 * to survive back to the caller, which writes it out.
	 */
	private function write(string $userId, string $session, array &$meta, string $typed, string $said): void {
		if (trim($typed) === '' && trim($said) === '') {
			return;
		}
		$step = (int)($meta['step'] ?? 0) + 1;
		$meta['step'] = $step;
		try {
			$entity = new TermLogEntity();
			$entity->setUserId($userId);
			$entity->setTermSession($session);
			$entity->setKind((string)($meta['kind'] ?? 'shell'));
			$entity->setTarget((string)($meta['target'] ?? ''));
			$entity->setStep($step);
			$entity->setTyped($this->clean($typed, self::MAX_TYPED));
			$entity->setSaid($this->clean($said, self::MAX_SAID));
			$entity->setCreated(time());
			$this->mapper->insert($entity);
			$keep = max(1, (int)($meta['keep'] ?? 1));
			if ($step > $keep) {
				$this->mapper->trim($userId, $session, $keep);
			}
		} catch (\Throwable $e) {
			// A terminal must not stop working because its log could not be
			// written, so this is noted and the session carries on.
			$this->logger->warning('NetBase: a terminal step could not be recorded', ['exception' => $e, 'app' => 'netbase']);
		}
	}

	/** Read a file and empty it in one go, so nothing is recorded twice. */
	private function take(string $path): string {
		if (!file_exists($path)) {
			return '';
		}
		$handle = @fopen($path, 'c+');
		if ($handle === false) {
			return '';
		}
		$out = '';
		if (flock($handle, LOCK_EX)) {
			$out = (string)stream_get_contents($handle);
			ftruncate($handle, 0);
			fflush($handle);
			flock($handle, LOCK_UN);
		}
		fclose($handle);
		return $out;
	}

	/**
	 * What a terminal sends is not text: it is text with instructions threaded
	 * through it — move the cursor here, paint this red, retitle the window.
	 * Read back months later those are noise, so the colours and the cursor
	 * moves come out and the words stay.
	 */
	private function clean(string $raw, int $limit): string {
		$raw = str_replace("\0", '', $raw);
		// Escape sequences: the CSI and OSC forms cover what a shell emits.
		$raw = (string)preg_replace('/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\\\)/', '', $raw);
		$raw = (string)preg_replace('/\x1b\[[0-9;?]*[ -\/]*[@-~]/', '', $raw);
		$raw = (string)preg_replace('/\x1b[@-_]/', '', $raw);
		$raw = str_replace("\r\n", "\n", $raw);
		$raw = str_replace("\r", "\n", $raw);
		if (strlen($raw) > $limit) {
			// The beginning and the end are what say what happened; the middle
			// of a long listing is the part nobody reads.
			$head = substr($raw, 0, (int)($limit * 0.6));
			$tail = substr($raw, -(int)($limit * 0.3));
			$raw = $head . "\n…\n" . $tail;
		}
		return $raw;
	}

	/**
	 * Where one terminal's half-built step waits.
	 *
	 * Named from a hash of the account and the session, so no request can
	 * reach a directory belonging to anybody else however the session is
	 * spelt — the same rule the terminal itself follows, in a base of its own
	 * so the two never tidy up after each other.
	 */
	private function dir(string $userId, string $session, bool $create): string {
		if (preg_match('/^[a-f0-9]{16,64}$/', $session) !== 1) {
			return '';
		}
		$base = sys_get_temp_dir() . '/netbase-termlog';
		if ($create && !is_dir($base)) {
			@mkdir($base, 0700, true);
		}
		$dir = $base . '/' . hash('sha256', $userId . "\0" . $session);
		if ($create && !is_dir($dir)) {
			@mkdir($dir, 0700, true);
			$this->sweep($base);
		}
		return $dir;
	}

	/** Clear away anything a crashed request left behind. */
	private function sweep(string $base): void {
		$old = time() - 86400;
		foreach ((array)@scandir($base) as $name) {
			if ($name === '.' || $name === '..') {
				continue;
			}
			$dir = $base . '/' . $name;
			if (is_dir($dir) && (int)@filemtime($dir) < $old) {
				foreach ((array)@scandir($dir) as $file) {
					if ($file !== '.' && $file !== '..') {
						@unlink($dir . '/' . $file);
					}
				}
				@rmdir($dir);
			}
		}
	}
}
