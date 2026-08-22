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
				throw new Error(response.statusText);
			}
			return response.json();
		}).then(function () {
			say(t('Settings saved'), 'ok');
		}).catch(function (error) {
			say(String(error.message || error), 'err');
		});
	});
}());
