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
}

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
};
