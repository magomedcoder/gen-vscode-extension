export function withCause(message: string, cause?: unknown): Error {
	const err = new Error(message, cause instanceof Error ? { cause } : undefined);
	return err;
}

export function toAbortError(cause?: unknown): Error {
	const err = withCause('Операция отменена', cause);
	err.name = 'AbortError';
	return err;
}

export function toTimeoutError(timeoutMs: number, cause?: unknown): Error {
	const err = withCause(`Истекло время ожидания LLM (${Math.round(timeoutMs / 1000)} с)`, cause);
	err.name = 'TimeoutError';
	return err;
}

export function isAbortError(err: unknown): boolean {
	return (err instanceof Error && err.name === 'AbortError') || (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError');
}

export function isTimeoutError(err: unknown): boolean {
	return err instanceof Error && err.name === 'TimeoutError';
}

export function isRetryableStatus(status: number): boolean {
	return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function httpErrorMessage(status: number, detail: string): string {
	const hint = status === 401 || status === 403
		? 'Проверь API-ключ в настройках.'
		: status === 429
			? 'Слишком много запросов, подожди и повтори.'
			: status >= 500
				? 'Сервер LLM временно недоступен.'
				: '';

	const body = detail.trim() || 'без текста';
	return `Ошибка HTTP ${status}: ${body}${hint ? ` ${hint}` : ''}`;
}

export class LlmHttpError extends Error {
	constructor(message: string, readonly status: number, cause?: unknown) {
		super(message, cause instanceof Error ? { cause } : undefined);
		this.name = 'LlmHttpError';
	}
}

export function isRetryableError(err: unknown): boolean {
	if (isAbortError(err)) {
		return false;
	}

	if (err instanceof LlmHttpError) {
		return isRetryableStatus(err.status);
	}

	return err instanceof TypeError;
}

export function retryDelayMs(attempt: number): number {
	return 400 * 2 ** attempt;
}

export function parseErrorDetail(text: string, parsed: unknown, statusText: string): string {
	const fromJson = (parsed as { 
		error?: {
			message?: string
		}
	} | undefined)?.error?.message;
	return (fromJson ?? text.slice(0, 300) ?? statusText).trim();
}
