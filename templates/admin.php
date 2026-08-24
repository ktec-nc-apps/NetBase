<?php
declare(strict_types=1);
/** @var array $_ */
/** @var \OCP\IL10N $l */
?>
<div id="netbase-admin" class="section">
	<h2><?php p($l->t('NetBase')); ?></h2>
	<p class="settings-hint"><?php p($l->t('Administrators always have every tool. Choose here what everyone else may reach.')); ?></p>
	<p class="settings-hint"><?php p($l->t('Set every tool to administrators only and NetBase disappears from everyone else\'s app menu, and its page answers 403 — rather than showing them a door that will not open. The setting below turns that off if you would rather they saw it.')); ?></p>

	<table class="nb-tools">
		<thead>
			<tr>
				<th><?php p($l->t('Tool')); ?></th>
				<th><?php p($l->t('Probes the network')); ?></th>
				<th><?php p($l->t('Allowed for')); ?></th>
			</tr>
		</thead>
		<tbody>
		<?php foreach ($_['tools'] as $id => $meta) { ?>
			<tr>
				<td><?php p($l->t($meta['label'])); ?></td>
				<td>
					<span class="nb-pill <?php p($meta['probes'] ? 'warn' : 'ok'); ?>">
						<?php p($meta['probes'] ? $l->t('yes') : $l->t('no')); ?>
					</span>
				</td>
				<td>
					<select class="nb-level" data-tool="<?php p($id); ?>">
						<?php foreach ([
							'admin' => $l->t('Administrators only'),
							'groups' => $l->t('Administrators and the groups below'),
							'all' => $l->t('Every signed-in user'),
						] as $value => $label) { ?>
							<option value="<?php p($value); ?>"<?php p(($_['levels'][$id] ?? 'admin') === $value ? ' selected' : ''); ?>><?php p($label); ?></option>
						<?php } ?>
					</select>
				</td>
			</tr>
		<?php } ?>
		</tbody>
	</table>

	<div class="nb-actions">
		<button class="nb-bulk" data-level="admin"><?php p($l->t('All admin-only')); ?></button>
		<button class="nb-bulk" data-level="all"><?php p($l->t('All users')); ?></button>
	</div>

	<div class="nb-field">
		<label for="nb-groups"><?php p($l->t('Groups (comma separated)')); ?></label>
		<input type="text" id="nb-groups" value="<?php p($_['groups']); ?>" placeholder="<?php p($l->t('it-team, office')); ?>">
	</div>

	<div class="nb-field nb-check">
		<input type="checkbox" id="nb-hide" class="checkbox"<?php p($_['hideEmptyMenu'] ? ' checked' : ''); ?>>
		<label for="nb-hide"><?php p($l->t('Hide NetBase from the app menu for users who may not use any tool')); ?></label>
		<p class="settings-hint nb-sub"><?php p($l->t('This is what makes an all-administrators setup vanish from other people\'s menus.')); ?></p>
	</div>

	<div class="nb-field nb-narrow">
		<label for="nb-max"><?php p($l->t('Largest scan, in addresses')); ?></label>
		<input type="number" id="nb-max" min="256" max="1048576" value="<?php p((string)$_['maxHosts']); ?>">
	</div>

	<div class="nb-actions">
		<button id="nb-save" class="primary"><?php p($l->t('Save')); ?></button>
		<span id="nb-status" class="nb-status" role="status"></span>
	</div>

	<h3><?php p($l->t('This server')); ?></h3>
	<ul class="nb-facts">
		<li><?php p($l->t('System')); ?>: <strong><?php p($_['requirements']['distro']); ?></strong>
			<span class="nb-dim">PHP <?php p($_['requirements']['phpVersion']); ?><?php if ($_['requirements']['phpUser'] !== '') { ?> · <?php p($l->t('running as %s', [$_['requirements']['phpUser']])); } ?></span></li>
		<li><?php p($l->t('Vendor database')); ?>: <strong><?php p($l->t('%s IEEE prefixes', [number_format((int)$_['ouiEntries'])])); ?></strong>
			<span class="nb-dim"><?php p($l->t('Bundled; no MAC address ever leaves this server.')); ?></span></li>
		<li><?php p($l->t('Neighbour table')); ?>: <strong><?php p((string)$_['neighbourLimits']['gc3']); ?></strong>
			<span class="nb-dim"><?php p($l->t('Sweeping more addresses than this in one go makes the kernel log overflow warnings. Raise it with: sysctl -w net.ipv4.neigh.default.gc_thresh3=%s', [(string)max(8192, (int)$_['neighbourLimits']['gc3'] * 8)])); ?></span></li>
	</ul>

	<h3><?php p($l->t('Optional components')); ?></h3>
	<p class="settings-hint">
		<?php p($l->t('NetBase runs without any of these. Each one adds a specific capability, and the command below is the one for this system (%s).', [$_['requirements']['packageManagerLabel'] ?: $l->t('package manager not detected')])); ?>
	</p>
	<div class="nb-components">
		<?php foreach ($_['requirements']['components'] as $c) { ?>
			<div class="nb-component <?php p($c['present'] ? 'is-present' : 'is-missing'); ?>">
				<div class="nb-c-head">
					<span class="nb-pill <?php p($c['present'] ? 'ok' : 'warn'); ?>"><?php p($c['present'] ? $l->t('installed') : $l->t('missing')); ?></span>
					<strong><?php p($l->t($c['name'])); ?></strong>
				</div>
				<div class="nb-c-body">
					<p class="nb-c-enables"><?php p($l->t('Enables')); ?>: <?php p($l->t($c['enables'])); ?></p>
					<?php if (!$c['present']) { ?>
						<p class="nb-dim"><?php p($l->t($c['without'])); ?></p>
						<?php if ($c['install'] !== null) { ?>
							<pre class="nb-cmd"><?php p($c['install']); ?></pre>
						<?php } ?>
						<?php if (count($c['allInstall']) > 1) { ?>
							<details>
								<summary><?php p($l->t('Other distributions')); ?></summary>
								<pre class="nb-cmd"><?php foreach ($c['allInstall'] as $variant) {
									p($variant['command'] . '   # ' . $variant['label'] . "\n");
								} ?></pre>
							</details>
						<?php } ?>
					<?php } ?>
					<?php if ($c['after'] !== null) { ?>
						<p class="nb-after"><?php p($l->t('Then')); ?>: <code><?php p($l->t($c['after'])); ?></code></p>
					<?php } ?>
				</div>
			</div>
		<?php } ?>
	</div>
</div>
