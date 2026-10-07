<?php
declare(strict_types=1);
/** @var array $_ */
/** @var \OCP\IL10N $l */
$hub = $_['hub'];
$s = $_['settings'];
$off = !$hub['present'];
$providers = ['claude' => 'Claude', 'gemini' => 'Gemini', 'openai' => 'OpenAI'];
$reasons = [
	'no-key' => $l->t('No API key is set in AI-Hub.'),
	'no-cli' => $l->t('AI-Hub\'s command line tool is not set up.'),
	'no-store' => $l->t('AI-Hub needs a memory cache or a writable temporary folder.'),
	'no-model' => $l->t('No model is chosen in AI-Hub.'),
];
?>
<div id="netbase-ai-admin" class="section<?php if ($off) { p(' nb-ai-off'); } ?>"
	data-saved="<?php p($l->t('Saved.')); ?>" data-failed="<?php p($l->t('Could not save.')); ?>">
	<h2><?php p($l->t('AI assistant')); ?></h2>
	<p class="settings-hint"><?php p($l->t('NetBase asks AI-Hub for its AI: a chat at the right of the screen that knows NetBase, explains the result on the screen when asked, and reads only what is allowed here. It runs nothing itself. The key, the model and the limits are set in AI-Hub.')); ?></p>
	<?php if ($off) { ?>
		<p class="nb-ai-state warn"><?php p($l->t('AI-Hub is not installed or is switched off, so the assistant cannot be used. Install AI-Hub from the App Store to set it up here.')); ?></p>
	<?php } else { ?>
		<p class="nb-ai-state<?php if (!$hub['ready']) { p(' warn'); } ?>">
			<?php p($l->t('AI-Hub: %1$s (%2$s), model %3$s', [$providers[$hub['provider']] ?? $hub['provider'], $hub['mode'] === 'cli' ? $l->t('command line') : 'API', $hub['model'] !== '' ? $hub['model'] : '—'])); ?>
			— <?php p($hub['ready'] ? $l->t('Ready.') : ($reasons[$hub['reason']] ?? $hub['reason'])); ?>
		</p>
	<?php } ?>
	<fieldset <?php if ($off) { p('disabled'); } ?>>
		<p><input type="checkbox" class="checkbox" id="nb-ai-enabled" <?php if ($s['enabled']) { p('checked'); } ?>>
			<label for="nb-ai-enabled"><?php p($l->t('Use the AI assistant in NetBase')); ?></label></p>

		<h3><?php p($l->t('Who may use it')); ?></h3>
		<p><input type="radio" class="radio" name="nb-ai-users" id="nb-ai-users-all" value="all" <?php if ($s['users'] === 'all') { p('checked'); } ?>>
			<label for="nb-ai-users-all"><?php p($l->t('Everyone')); ?></label></p>
		<p><input type="radio" class="radio" name="nb-ai-users" id="nb-ai-users-groups" value="groups" <?php if ($s['users'] === 'groups') { p('checked'); } ?>>
			<label for="nb-ai-users-groups"><?php p($l->t('Only the members of these groups')); ?></label></p>
		<div class="nb-ai-groups">
			<?php foreach ($_['groups'] as $g) { $gid = 'nb-ai-g-' . md5($g['id']); ?>
				<p><input type="checkbox" class="checkbox" id="<?php p($gid); ?>" data-group="<?php p($g['id']); ?>" <?php if (in_array($g['id'], $s['groups'], true)) { p('checked'); } ?>>
					<label for="<?php p($gid); ?>"><?php p($g['name']); ?></label></p>
			<?php } ?>
		</div>
		<p class="settings-hint"><?php p($l->t('Someone who may use no tool in NetBase never sees the assistant, whoever is chosen here.')); ?></p>

		<h3><?php p($l->t('What it may read (read only — it never changes anything there)')); ?></h3>
		<?php
		$labels = [
			'screen' => $l->t('What is on the screen (the current tool\'s result)'),
			'devices' => $l->t('The device list (only for people allowed the Devices tool; notes are never read)'),
		];
		foreach ($labels as $src => $label) { ?>
			<p><input type="checkbox" class="checkbox" id="nb-ai-read-<?php p($src); ?>" data-read="<?php p($src); ?>"
				<?php if (in_array($src, $s['read'], true)) { p('checked'); } ?>>
				<label for="nb-ai-read-<?php p($src); ?>"><?php p($label); ?></label></p>
		<?php } ?>

		<h3><?php p($l->t('Web search')); ?></h3>
		<p><input type="checkbox" class="checkbox" id="nb-ai-search" <?php if ($s['search']) { p('checked'); } ?> <?php if (!$off && !$hub['search']) { p('disabled'); } ?>>
			<label for="nb-ai-search"><?php p($l->t('Let it search the web (on the AI provider\'s side: this server\'s own network is never reached)')); ?></label></p>
		<?php if (!$off && !$hub['search']) { ?>
			<p class="settings-hint"><?php p($l->t('Not available with the way AI-Hub connects to the AI.')); ?></p>
		<?php } ?>

		<h3><?php p($l->t('Administrator tools (advanced)')); ?></h3>
		<div class="nb-ai-danger">
			<p><input type="checkbox" class="checkbox" id="nb-ai-admin-tools" <?php if ($s['adminTools']) { p('checked'); } ?>>
				<label for="nb-ai-admin-tools"><?php p($l->t('Give administrators the RegiBase, SSH and shell tools through the assistant')); ?></label></p>
			<p class="nb-ai-warn"><?php p($l->t('⚠ Leave this off unless you mean it. With it on, every member of the admin group can, from the assistant in a chat message, read their own RegiBase, run commands over SSH, and run any shell command on this server with the rights of the web server user. It is never offered to anyone who is not an administrator, and every tool checks again before it runs — but for an administrator it is real, direct access to this machine.')); ?></p>
		</div>

		<p class="nb-ai-save"><button type="button" class="button primary" id="nb-ai-save"><?php p($l->t('Save')); ?></button>
			<span class="nb-ai-msg" aria-live="polite"></span></p>
	</fieldset>
</div>
