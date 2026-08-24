<?php

declare(strict_types=1);

namespace OCA\NetBase\Settings;

use OCA\NetBase\AppInfo\Application;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

class AdminSection implements IIconSection {
	public function __construct(
		private IL10N $l,
		private IURLGenerator $urlGenerator,
	) {
	}

	public function getID(): string {
		return Application::APP_ID;
	}

	public function getName(): string {
		return $this->l->t('NetBase');
	}

	public function getPriority(): int {
		return 80;
	}

	public function getIcon(): string {
		// The settings list draws its icons dark and inverts them for a dark
		// theme; the app menu wants the white one. They are not the same file.
		return $this->urlGenerator->imagePath(Application::APP_ID, 'app-dark.svg');
	}
}
