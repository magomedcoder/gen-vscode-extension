import type { GenSettings } from '../../../config/types';

export type SettingsPageId = 'connection' | 'chat' | 'request' | 'comments' | 'security' | 'logging';

export type SetSettingsField = <K extends keyof GenSettings>(key: K, value: GenSettings[K]) => void;

export interface SettingsPageProps {
	draft: GenSettings;
	setField: SetSettingsField;
}

export const SETTINGS_PAGES: Array<{
	id: SettingsPageId;
	title: string;
}> = [
	{ id: 'connection', title: 'Подключение' },
	{ id: 'chat', title: 'Чат и агент' },
	{ id: 'request', title: 'Запросы' },
	{ id: 'comments', title: 'Комментарии' },
	{ id: 'security', title: 'Безопасность' },
	{ id: 'logging', title: 'Логи' },
];
