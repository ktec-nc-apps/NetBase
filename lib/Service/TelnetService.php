<?php

declare(strict_types=1);

namespace OCA\NetBase\Service;

use OCP\IL10N;
use Psr\Log\LoggerInterface;

/**
 * A line typed at a device over Telnet, and what it says back.
 *
 * PHP cannot hold a connection open from one request to the next, so each line
 * is its own session: connect, sign in, send the line, read the answer, hang
 * up. For the switches and the older routers that still speak Telnet this is
 * what a person does by hand anyway, and it means nothing is left open on the
 * device between one command and the next.
 *
 * Telnet carries everything in the clear, this service included. It exists
 * because the equipment exists, not because it is a good idea.
 */
class TelnetService {
	private const IAC = 255;
	private const DO = 253;
	private const WILL = 251;
	private const WONT = 252;
	private const DONT = 254;

	/** How long to wait for the device to stop talking before deciding it has finished. */
	private const IDLE = 0.6;

	public function __construct(
		private ToolService $tools,
		private IL10N $l,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Sign in if asked to, run one line, and return what came back.
	 *
	 * @return array{ok: bool, host: string, port: int, output: string, error: ?string, prompt: string}
	 */
	public function run(
		string $host,
		int $port = 23,
		string $user = '',
		string $password = '',
		string $command = '',
		float $timeout = 12.0,
	): array {
		$host = $this->tools->validateHost($host);
		$port = max(1, min(65535, $port));
		$timeout = min(30.0, max(3.0, $timeout));
		$target = str_contains($host, ':') && filter_var($host, FILTER_VALIDATE_IP) !== false ? '[' . $host . ']' : $host;

		$errno = 0;
		$errstr = '';
		$stream = @stream_socket_client('tcp://' . $target . ':' . $port, $errno, $errstr, min(8.0, $timeout));
		if ($stream === false) {
			return $this->failed($host, $port, $errstr ?: $this->l->t('Could not connect'));
		}
		stream_set_timeout($stream, 2);
		$deadline = microtime(true) + $timeout;

		try {
			$seen = $this->readUntil($stream, $deadline, '/(login|user ?name)\s*[:>]\s*$/i');
			if ($user !== '' && preg_match('/(login|user ?name)\s*[:>]\s*$/i', $seen) === 1) {
				$this->send($stream, $user);
				$seen = $this->readUntil($stream, $deadline, '/password\s*[:>]\s*$/i');
			}
			if ($password !== '' && preg_match('/password\s*[:>]\s*$/i', $seen) === 1) {
				$this->send($stream, $password);
				$seen = $this->readUntil($stream, $deadline, null);
			}
			// A device that asks again is a device that did not accept them.
			if (preg_match('/(login|user ?name|password)\s*[:>]\s*$/i', $seen) === 1 && ($user !== '' || $password !== '')) {
				@fclose($stream);
				return $this->failed($host, $port, $this->l->t('The device did not accept that user name and password.'));
			}
			$prompt = $this->promptOf($seen);
			if ($command === '') {
				// Just opening the window: the banner and the prompt are the answer.
				@fclose($stream);
				return ['ok' => true, 'host' => $host, 'port' => $port, 'output' => $this->clean($seen), 'error' => null, 'prompt' => $prompt];
			}
			$this->send($stream, $command);
			$answer = $this->readUntil($stream, $deadline, null);
			@fclose($stream);
			return [
				'ok' => true, 'host' => $host, 'port' => $port,
				'output' => $this->clean($this->withoutEcho($answer, $command)),
				'error' => null, 'prompt' => $this->promptOf($answer) ?: $prompt,
			];
		} catch (\Throwable $e) {
			@fclose($stream);
			$this->logger->warning('NetBase telnet: ' . $e->getMessage(), ['app' => 'netbase']);
			return $this->failed($host, $port, $e->getMessage());
		}
	}

	/** @return array{ok: bool, host: string, port: int, output: string, error: string, prompt: string} */
	private function failed(string $host, int $port, string $why): array {
		return ['ok' => false, 'host' => $host, 'port' => $port, 'output' => '', 'error' => $why, 'prompt' => ''];
	}

	private function send($stream, string $line): void {
		@fwrite($stream, $line . "\r\n");
	}

	/**
	 * Read until the device asks for something, or stops talking.
	 *
	 * Telnet has no end-of-answer marker. What it has is a pause: the device
	 * says its piece and then waits. So the answer is whatever arrives before
	 * the line goes quiet, unless a prompt we were told to look for turns up
	 * first.
	 */
	private function readUntil($stream, float $deadline, ?string $prompt): string {
		$text = '';
		$quiet = microtime(true) + self::IDLE;
		while (microtime(true) < $deadline && microtime(true) < $quiet && strlen($text) < 65536) {
			$read = [$stream];
			$write = null;
			$except = null;
			$left = min($quiet, $deadline) - microtime(true);
			if ($left <= 0 || @stream_select($read, $write, $except, 0, (int)($left * 1_000_000)) < 1) {
				break;
			}
			$chunk = @fread($stream, 4096);
			if ($chunk === false || $chunk === '') {
				break;
			}
			$text .= $this->negotiate($stream, $chunk);
			$quiet = microtime(true) + self::IDLE;
			if ($prompt !== null && preg_match($prompt, $this->tail($text)) === 1) {
				break;
			}
		}
		return $text;
	}

	/**
	 * Strip the option negotiation out of what arrived, answering it as we go.
	 *
	 * Everything is refused — DO becomes WONT, WILL becomes DONT — which keeps
	 * the device talking without our pretending to be a terminal we are not.
	 */
	private function negotiate($stream, string $chunk): string {
		$text = '';
		$reply = '';
		$length = strlen($chunk);
		for ($i = 0; $i < $length; $i++) {
			if (ord($chunk[$i]) !== self::IAC || $i + 2 >= $length) {
				$text .= $chunk[$i];
				continue;
			}
			$verb = ord($chunk[$i + 1]);
			$option = ord($chunk[$i + 2]);
			if ($verb === self::DO) {
				$reply .= chr(self::IAC) . chr(self::WONT) . chr($option);
			} elseif ($verb === self::WILL) {
				$reply .= chr(self::IAC) . chr(self::DONT) . chr($option);
			}
			$i += 2;
		}
		if ($reply !== '') {
			@fwrite($stream, $reply);
		}
		return $text;
	}

	/** The device echoes what was typed; it does not need saying twice. */
	private function withoutEcho(string $text, string $command): string {
		$lines = preg_split('/\r\n|\r|\n/', $text) ?: [];
		if ($lines !== [] && str_contains($lines[0], $command)) {
			array_shift($lines);
		}
		return implode("\n", $lines);
	}

	/** The last line, when it looks like a prompt waiting for the next command. */
	private function promptOf(string $text): string {
		$tail = trim($this->tail($this->clean($text)));
		return preg_match('/[>#\$%]\s*$/', $tail) === 1 ? mb_substr($tail, 0, 80) : '';
	}

	private function tail(string $text): string {
		return mb_substr($this->clean($text), -160);
	}

	private function clean(string $text): string {
		// Colour codes and cursor moves, which mean nothing without a terminal.
		$text = preg_replace('/\x1b\[[0-9;?]*[A-Za-z]/', '', $text) ?? $text;
		$text = preg_replace('/[^\P{C}\n\t]+/u', '', $text) ?? $text;
		return rtrim($text);
	}
}
