import type { GenSettings } from '../../../config/types';

export type SettingsPageId = | 'connection' | 'chat' | 'mcp' | 'request' | 'comments' | 'security' | 'logging' | 'usage';

export type SetSettingsField = <K extends keyof GenSettings>(key: K, value: GenSettings[K]) => void;

export interface SettingsPageProps {
	draft: GenSettings;
	setField: SetSettingsField;
}

export const SETTINGS_PAGE_IDS: SettingsPageId[] = [
	'connection',
	'chat',
	'mcp',
	'request',
	'comments',
	'security',
	'logging',
	'usage',
];

// Ключевые слова для поиска разделов настроек (EN+RU + имена полей)
export const SETTINGS_PAGE_KEYWORDS: Record<SettingsPageId, string[]> = {
	connection: [
		'connection', 'general', 'основное', 'url', 'baseurl', 'api', 'key', 'ключ',
		'model', 'модель', 'auth', 'bearer', 'authorization', 'header', 'scheme',
	],
	chat: [
		'chat', 'agent', 'чат', 'агент', 'mode', 'режим', 'persona', 'персона',
		'skills', 'скиллы', 'instruction', 'инструкции', 'iterations', 'итерации',
		'auth', 'plan', 'план', 'format', 'formatAfterEdit', 'workspace', 'notify',
		'subagent', 'субагент',
	],
	mcp: [
		'mcp', 'servers', 'серверы', 'stdio', 'tools', 'инструменты', 'json',
	],
	request: [
		'request', 'requests', 'запросы', 'temperature', 'температура', 'tokens',
		'токены', 'timeout', 'таймаут', 'context', 'контекст', 'maxTokens',
		'vision', 'изображения', 'attachment', 'вложения',
	],
	comments: [
		'comments', 'комментарии', 'comment', 'style', 'стиль', 'preview',
		'просмотр', 'diff', 'prompt',
	],
	security: [
		'security', 'безопасность', 'denied', 'запрет', 'paths', 'пути', 'glob',
		'sensitive', 'чувствительные', 'commands', 'команды', 'secrets', 'секреты',
		'external', 'внешние', 'redact', 'approval', 'политика', 'autoApprove',
		'continueLoopOnDeny', 'capability', 'shell', 'edits', 'mcp', 'web',
	],
	logging: [
		'logging', 'logs', 'логи', 'лог', 'folder', 'папка', 'llm', 'agent',
	],
	usage: [
		'usage', 'quota', 'квота', 'tokens', 'токены', 'model', 'модель',
		'prompt', 'completion', 'requests', 'запросы', 'ledger',
	],
};

export function settingsNavTitleKey(id: SettingsPageId): string {
	return `settings.nav.${id}`;
}
