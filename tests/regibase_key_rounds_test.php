<?php
/**
 * Regression test: the RegiBase master key is checked with the rounds it was made with.
 *
 * RegiBase 0.20.0 began making a master key that is set or changed with
 * 600,000 PBKDF2 rounds, and keeps the count per user (enc_kdf_iter); a key
 * from before has 250,000 and no count. NetBase derived every key with
 * 250,000, so a newer key was refused as wrong and saved connections could
 * not be opened at all (found 2026-10-18).
 *
 * No Nextcloud is needed: the settings and the session are played here.
 *
 * Run: php tests/regibase_key_rounds_test.php
 */
namespace OCP {
	if (!interface_exists(IConfig::class)) {
		interface IConfig {
		}
	}
	if (!interface_exists(ISession::class)) {
		interface ISession {
		}
	}
}

namespace {
	require __DIR__ . '/../lib/Service/RegiBaseBridge.php';

	use OCA\NetBase\Service\RegiBaseBridge;

	class FakeConfig implements OCP\IConfig {
		public function __construct(public array $values) {
		}
		public function getUserValue($uid, $app, $key, $default = '') {
			return $this->values[$key] ?? $default;
		}
	}
	class FakeSession implements OCP\ISession {
		public array $data = [];
		public function get($k) {
			return $this->data[$k] ?? null;
		}
		public function set($k, $v) {
			$this->data[$k] = $v;
		}
		public function remove($k) {
			unset($this->data[$k]);
		}
	}

	/** A bridge over the given settings, built without the parts this test does not touch. */
	function bridge(array $values, FakeSession $session): RegiBaseBridge {
		$b = (new ReflectionClass(RegiBaseBridge::class))->newInstanceWithoutConstructor();
		foreach (['config' => new FakeConfig($values), 'session' => $session] as $name => $value) {
			$p = new ReflectionProperty(RegiBaseBridge::class, $name);
			$p->setAccessible(true);
			$p->setValue($b, $value);
		}
		return $b;
	}

	/** The settings RegiBase writes for a key made with this many rounds. */
	function keyed(string $password, int $rounds, bool $storeCount): array {
		$salt = base64_encode(random_bytes(16));
		$key = hash_pbkdf2('sha256', $password, base64_decode($salt), $rounds, 32, true);
		$session = new FakeSession();
		$session->data['netbase_regibase_key'] = base64_encode($key);
		$verifier = bridge([], $session)->seal('regibase-ok');
		$out = ['enc_enabled' => '1', 'enc_salt' => $salt, 'enc_verifier' => $verifier];
		if ($storeCount) {
			$out['enc_kdf_iter'] = (string)$rounds;
		}
		return $out;
	}

	$fail = 0;
	$check = static function (bool $ok, string $what) use (&$fail): void {
		echo ($ok ? 'ok   ' : 'FAIL ') . $what . "\n";
		if (!$ok) {
			$fail++;
		}
	};

	$new = keyed('Master-2026', 600000, true);
	$check(bridge($new, new FakeSession())->unlock('u', 'Master-2026'), 'a key made since RegiBase 0.20.0 (600,000 rounds) is accepted');
	$check(!bridge($new, new FakeSession())->unlock('u', 'master-2026'), 'a wrong key is still refused');

	$old = keyed('Old-Key-2025', 250000, false);
	$check(bridge($old, new FakeSession())->unlock('u', 'Old-Key-2025'), 'an older key (250,000 rounds, no count stored) is accepted');

	$odd = keyed('Odd-Key-2026', 250000, false) + ['enc_kdf_iter' => '12'];
	$check(bridge($odd, new FakeSession())->unlock('u', 'Odd-Key-2026'), 'a count RegiBase could not have written falls back to 250,000');

	echo $fail ? "$fail FAILED\n" : "all good\n";
	exit($fail ? 1 : 0);
}
