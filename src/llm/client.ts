import { getSettings } from '../config/settings';
import type { ChatMessage, CompleteParams, CompleteResult, LlmClient } from './types';

interface ChatCompletionsResponse {
	choices?: Array<{
		message?: {
			content?: string | null
		};
		text?: string;
	}>;
	error?: {
		message?: string
	};
}

export class HttpLlmClient implements LlmClient {
	constructor(private readonly getConfig = getSettings) {}

	async complete(params: CompleteParams): Promise<CompleteResult> {
		const settings = this.getConfig();
		const body: Record<string, unknown> = {
			model: settings.model,
			messages: params.messages,
			temperature: settings.temperature,
			max_tokens: settings.maxTokens,
			stream: false,
		};

		const data = await this.requestJson<ChatCompletionsResponse>(
			'/v1/chat/completions', 
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(body),
				signal: params.signal,
			}, 
			settings.requestTimeoutMs, 
			settings.baseUrl
		);

		if (data.error?.message) {
			throw new Error(data.error.message);
		}

		const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';

		if (!content.trim()) {
			throw new Error('LLM-сервер вернул пустой ответ');
		}

		return { content };
	}

	private async requestJson<T>(path: string, init: RequestInit, timeoutMs: number, baseUrl: string): Promise<T> {
		const url = `${baseUrl}${path}`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		const onAbort = () => controller.abort();
		if (init.signal) {
			if (init.signal.aborted) {
				controller.abort();
			} else {
				init.signal.addEventListener('abort', onAbort, { once: true });
			}
		}

		try {
			const response = await fetch(url, {
				...init,
				signal: controller.signal,
			});

			const text = await response.text();
			let parsed: unknown = undefined;
			if (text.trim()) {
				try {
					parsed = JSON.parse(text) as unknown;
				} catch {
					throw new Error(`Некорректный JSON от LLM-сервера (HTTP ${response.status}): ${text.slice(0, 200)}`);
				}
			}

			if (!response.ok) {
				const msg = (parsed as {
					error?: {
						message?: string
					}
				})?.error?.message ?? text.slice(0, 300) ?? response.statusText;
				throw new Error(`HTTP ${response.status}: ${msg}`);
			}

			return (parsed ?? {}) as T;
		} catch (err) {
			throw new Error(err instanceof Error ? err.message : String(err));
		} finally {
			clearTimeout(timer);
			init.signal?.removeEventListener('abort', onAbort);
		}
	}
}

export type { ChatMessage };
