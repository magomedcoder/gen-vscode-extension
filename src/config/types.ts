export type CommentStyle = 'inline' | 'block';

export interface GenSettings {
	baseUrl: string;
	model: string;
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
	 * default - 2048
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
	temperature: 0.2,
	maxTokens: 2048,
	requestTimeoutMs: 120_000,
	maxInputChars: 8000,
	commentStyle: 'inline',
	previewBeforeApply: true,
};
