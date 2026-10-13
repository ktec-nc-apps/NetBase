/* NetBase — administration settings panel.
 * Plain DOM, no framework: this page is rendered by Nextcloud's own settings
 * app, and it only has to collect a handful of values and POST them. */
(function () {
	'use strict';

	var root = document.getElementById('netbase-admin');
	if (!root) {
		return;
	}

	var BASE = (window.OC && OC.generateUrl) ? OC.generateUrl('/apps/netbase') : '/apps/netbase';
	var status = document.getElementById('nb-status');

	function token() {
		try {
			if (window.OC && OC.requestToken) {
				return OC.requestToken;
			}
		} catch (e) { /* fall through */ }
		var head = document.getElementsByTagName('head')[0];
		return (head && head.getAttribute('data-requesttoken')) || '';
	}

	function t(text) {
		try {
			if (typeof window.t === 'function') {
				return window.t('netbase', text);
			}
		} catch (e) { /* raw */ }
		return text;
	}

	function say(message, kind) {
		status.textContent = message;
		status.className = 'nb-status' + (kind ? ' ' + kind : '');
		if (kind === 'ok') {
			setTimeout(function () {
				if (status.textContent === message) {
					status.textContent = '';
					status.className = 'nb-status';
				}
			}, 4000);
		}
	}

	root.querySelectorAll('.nb-bulk').forEach(function (button) {
		button.addEventListener('click', function () {
			var level = button.dataset.level;
			root.querySelectorAll('.nb-level').forEach(function (select) {
				select.value = level;
			});
		});
	});

	// Only the fields of the chosen way of sending Wake-on-LAN are shown.
	var wolMethod = document.getElementById('nb-wol-method');
	function showWol() {
		root.querySelectorAll('[data-for]').forEach(function (el) {
			el.hidden = el.dataset.for.split(' ').indexOf(wolMethod.value) < 0;
		});
	}
	wolMethod.addEventListener('change', showWol);
	showWol();

	document.getElementById('nb-save').addEventListener('click', function () {
		var levels = {};
		root.querySelectorAll('.nb-level').forEach(function (select) {
			levels[select.dataset.tool] = select.value;
		});
		var body = {
			settings: {
				admin: {
					levels: levels,
					groups: document.getElementById('nb-groups').value,
					hideEmptyMenu: document.getElementById('nb-hide').checked,
					maxHosts: parseInt(document.getElementById('nb-max').value, 10) || 65536,
					allowSelf: document.getElementById('nb-self').checked,
					proxyMaxConn: parseInt(document.getElementById('nb-pmc').value, 10) || 0,
					proxyRetries: parseInt(document.getElementById('nb-pr').value, 10) || 0,
					proxyRetryMs: parseInt(document.getElementById('nb-prm').value, 10) || 0,
					wolMethod: document.getElementById('nb-wol-method').value,
					wolAddress: document.getElementById('nb-wol-address').value,
					wolPort: parseInt(document.getElementById('nb-wol-port').value, 10) || 9,
					wolCommand: document.getElementById('nb-wol-command').value,
				},
			},
		};
		say(t('Saving…'));
		fetch(BASE + '/api/settings', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'requesttoken': token() },
			credentials: 'same-origin',
			body: JSON.stringify(body),
		}).then(function (response) {
			if (!response.ok) {
				// A refused value comes back with its reason; say that, not just "Bad Request".
				return response.json().catch(function () { return {}; }).then(function (body) {
					throw new Error((body && body.error) || response.statusText);
				});
			}
			return response.json();
		}).then(function () {
			say(t('Settings saved'), 'ok');
		}).catch(function (error) {
			say(String(error.message || error), 'err');
		});
	});
}());
