/* NetBase — administration settings: the AI assistant (through AI-Hub).
 * Plain DOM, like admin.js: the page is rendered by Nextcloud's own settings
 * app, and this only has to collect a handful of values and POST them. */
(function () {
	'use strict';
	function ready(fn) { if (document.readyState !== 'loading') { fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
	ready(function () {
		var root = document.getElementById('netbase-ai-admin');
		if (!root) { return; }
		var BASE = (window.OC && OC.generateUrl) ? OC.generateUrl('/apps/netbase') : '/apps/netbase';
		var msg = root.querySelector('.nb-ai-msg');
		var groupsBox = root.querySelector('.nb-ai-groups');
		function token() {
			try { if (window.OC && OC.requestToken) { return OC.requestToken; } } catch (e) { /* fall through */ }
			var head = document.getElementsByTagName('head')[0];
			return (head && head.getAttribute('data-requesttoken')) || '';
		}
		function syncGroups() {
			var only = root.querySelector('#nb-ai-users-groups');
			groupsBox.classList.toggle('dim', !(only && only.checked));
		}
		root.querySelectorAll('input[name="nb-ai-users"]').forEach(function (r) { r.addEventListener('change', syncGroups); });
		syncGroups();
		root.querySelector('#nb-ai-save').addEventListener('click', function () {
			var users = root.querySelector('input[name="nb-ai-users"]:checked');
			var body = {
				enabled: root.querySelector('#nb-ai-enabled').checked,
				users: users ? users.value : 'all',
				groups: Array.prototype.map.call(root.querySelectorAll('input[data-group]:checked'), function (x) { return x.getAttribute('data-group'); }),
				read: Array.prototype.map.call(root.querySelectorAll('input[data-read]:checked'), function (x) { return x.getAttribute('data-read'); }),
				search: root.querySelector('#nb-ai-search').checked,
				adminTools: root.querySelector('#nb-ai-admin-tools').checked,
			};
			msg.textContent = '';
			fetch(BASE + '/api/ai/admin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', requesttoken: token() },
				credentials: 'same-origin',
				body: JSON.stringify(body),
			}).then(function (r) {
				msg.textContent = r.ok ? root.getAttribute('data-saved') : root.getAttribute('data-failed');
			}).catch(function () { msg.textContent = root.getAttribute('data-failed'); });
		});
	});
})();
