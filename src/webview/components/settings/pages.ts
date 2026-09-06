import type { GenSettings } from '../../../config/types';

export type SettingsPageId = | 'connection' | 'chat' | 'agent' | 'security' | 'project' | 'mcp' | 'journal';

export type SetSettingsField = <K extends keyof GenSettings>(key: K, value: GenSettings[K]) => void;

export interface SettingsPageProps {
	draft: GenSettings;
	setField: SetSettingsField;
}

export const SETTINGS_PAGE_IDS: SettingsPageId[] = ['connection', 'chat', 'agent', 'security', 'project', 'mcp', 'journal'];

export const SETTINGS_PAGE_CODICON: Record<SettingsPageId, string> = {
	connection: 'plug',
	chat: 'comment-discussion',
	agent: 'hubot',
	security: 'shield',
	project: 'folder',
	mcp: 'server',
	journal: 'history',
};

export function settingsNavTitleKey(id: SettingsPageId): string {
	return `settings.nav.${id}`;
}
