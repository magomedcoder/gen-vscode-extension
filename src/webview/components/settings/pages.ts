import type { GenSettings } from '../../../config/types';

export type SettingsPageId = 'connection' | 'chat' | 'request' | 'comments' | 'security' | 'logging';

export type SetSettingsField = <K extends keyof GenSettings>(key: K, value: GenSettings[K]) => void;

export interface SettingsPageProps {
	draft: GenSettings;
	setField: SetSettingsField;
}

export const SETTINGS_PAGE_IDS: SettingsPageId[] = [
	'connection',
	'chat',
	'request',
	'comments',
	'security',
	'logging',
];

export function settingsNavTitleKey(id: SettingsPageId): string {
	return `settings.nav.${id}`;
}
