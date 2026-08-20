export type ChatMode = 'ask' | 'agent';
export type AgentAuthLevel = 'auto' | 'ask' | 'open';
export type CommentStyle = 'inline' | 'block';

export interface GenSettings {
	baseUrl: string;
	model: string;
	/**
	 * Режим чата по умолчанию: ask (без tools) или agent (tool-calling)
	 */
	chatMode: ChatMode;
	/**
	 * Максимум итераций agent loop (LLM -> tools -> LLM)
	 *
	 * min - 1
	 * max - 40
	 * default - 40
	 */
	agentMaxIterations: number;
	/**
	 * Чтение - только просмотр; Спросить - подтверждать правки; Без спроса - без диалогов, всё в лог.
	 */
	agentAuthLevel: AgentAuthLevel;
	/**
	 * Температура
	 *
	 * min - 0,
	 * max - 2,
	 *
	 * default - 0.2
	 *
	 * лучше держать низкой для стабильного формата
	 */
	temperature: number;
	/**
	 * Максимум токенов в ответе модели
	 *
	 * min - 64
	 *
	 * default - 8192
	 */
	maxTokens: number;
	/**
	 * Таймаут HTTP-запроса в миллисекундах
	 *
	 * min - 1000
	 *
	 * default - 120000
	 */
	requestTimeoutMs: number;
	/**
	 * Максимальное количество символов на входе
	 *
	 * min - 500
	 *
	 * default - 8000
	 */
	maxInputChars: number;
	/**
	 * Стиль комментариев
	 *
	 * inline - короткие строковые комментарии
	 * block - короткие блочные комментарии
	 */
	commentStyle: CommentStyle;
	previewBeforeApply: boolean;
	/**
	 * Дополнительные инструкции к system prompt для комментариев.
	 * Пусто - только стандартный prompt
	 */
	commentSystemPrompt: string;
	/**
	 * Glob-шаблоны запрещённых путей (по одному на строку). 
	 * Пусто - ничего не запрещать.
	 */
	deniedPaths: string[];
	/**
	 * JS-регулярки для маскировки секретов в тексте, уходящем в LLM. 
	 * Пусто - не маскировать.
	 */
	secretPatterns: string[];
	/**
	 * Имя HTTP-заголовка с ключом.
	 * Пусто - Authorization.
	 */
	authHeader: string;
	/**
	 * Схема значения (Bearer). 
	 * Пусто - сырой ключ без префикса.
	 */
	authScheme: string;
	/**
	 * Писать логи в Output и в файлы. 
	 * По умолчанию выключено.
	 */
	loggingEnabled: boolean;
}

export const EXAMPLE_DENIED_PATHS: string[] = [
	'.env',
	'.env.*',
	'credentials.json',
	'secrets.json',
	'id_rsa',
	'id_ed25519',
	'id_ecdsa',
	'.npmrc',
	'.pypirc',
	'.netrc',
	'*.pem',
	'*.key',
	'*.p12',
	'*.pfx',
	'node_modules',
	'.git',
];

export const EXAMPLE_SECRET_PATTERNS: string[] = [
	String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`,
	String.raw`\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]?[^\s'"]{8,}`,
	String.raw`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`,
	String.raw`\bBearer\s+[A-Za-z0-9\-._~+/]+=*`,
];

export const DEFAULT_SETTINGS: GenSettings = {
	baseUrl: '',
	model: '',
	chatMode: 'ask',
	agentMaxIterations: 40,
	agentAuthLevel: 'ask',
	temperature: 0.2,
	maxTokens: 8192,
	requestTimeoutMs: 120_000,
	maxInputChars: 8000,
	commentStyle: 'inline',
	previewBeforeApply: true,
	commentSystemPrompt: '',
	deniedPaths: [],
	secretPatterns: [],
	authHeader: 'Authorization',
	authScheme: 'Bearer',
	loggingEnabled: false,
};
