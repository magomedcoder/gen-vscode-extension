import { getSettings } from '../config/settings';
import type {
	ChatMessage,
	CompleteParams,
	CompleteResult,
	ListModelsParams,
	LlmClient,
	LlmToolCall,
} from './types';

interface ChatCompletionsResponse {
	choices?: Array<{
		message?: {
			content?: string | null;
			tool_calls?: Array<{
				id?: string;
				type?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		text?: string;
		finish_reason?: string;
	}>;
	error?: {
		message?: string;
	};
}

interface ModelsListResponse {
	data?: Array<{
		id?: string;
	}>;
	models?: Array<string | {
		id?: string;
		name?: string;
	}>;
	error?: {
		message?: string;
	};
}

function isAbortError(err: unknown): boolean {
	return ((err instanceof Error && err.name === 'AbortError') || (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError'));
}

function toAbortError(cause?: unknown): Error {
	const err = new Error('Операция отменена', { cause });
	err.name = 'AbortError';
	return err;
}

function looksLikeToolsUnsupported(err: unknown): boolean {
	const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
	if (!msg) {
		return false;
	}

	const mentionsTools = /tools?|tool_choice|tool call|function.?call|functions?/.test(msg);
	const unsupported = /unsupported|not support|unknown|unexpected|extra|invalid|unrecognized|does not allow|no longer/.test(msg);
	const httpReject = /ошибка http (400|404|422)/.test(msg);
	return mentionsTools && (unsupported || httpReject);
}

function parseToolCalls(raw: ChatCompletionsResponse['choices']): LlmToolCall[] | undefined {
	const calls = raw?.[0]?.message?.tool_calls;
	if (!calls?.length) {
		return undefined;
	}

	const parsed: LlmToolCall[] = [];
	for (const call of calls) {
		const name = call.function?.name?.trim();
		if (!name) {
			continue;
		}

		parsed.push({
			id: call.id?.trim() || `call_${parsed.length + 1}`,
			type: 'function',
			function: {
				name,
				arguments: call.function?.arguments ?? '{}',
			},
		});
	}

	return parsed.length > 0 ? parsed : undefined;
}

export class HttpLlmClient implements LlmClient {
	constructor(private readonly getConfig = getSettings) {}

	async complete(params: CompleteParams): Promise<CompleteResult> {
		const settings = this.getConfig();
		const useTools = Boolean(params.tools?.length) && params.toolChoice !== 'none';

		const attempt = async (withTools: boolean): Promise<CompleteResult> => {
			const body: Record<string, unknown> = {
				model: settings.model,
				messages: params.messages,
				temperature: settings.temperature,
				max_tokens: settings.maxTokens,
				stream: false,
			};

			if (withTools && params.tools?.length) {
				body.tools = params.tools;
				body.tool_choice = params.toolChoice ?? 'auto';
			}

			const data = await this.requestJson<ChatCompletionsResponse>('/v1/chat/completions', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(body),
					signal: params.signal,
				},
				settings.requestTimeoutMs,
				settings.baseUrl,
			);

			if (data.error?.message) {
				throw new Error(data.error.message);
			}

			const choice = data.choices?.[0];
			const toolCalls = parseToolCalls(data.choices);
			const content = choice?.message?.content ?? choice?.text ?? '';
			const text = typeof content === 'string' ? content : '';

			if (!text.trim() && !toolCalls?.length) {
				throw new Error('LLM-сервер вернул пустой ответ');
			}

			return {
				content: text,
				toolCalls,
				finishReason: choice?.finish_reason,
			};
		};

		if (!useTools) {
			return attempt(false);
		}

		try {
			return await attempt(true);
		} catch (err) {
			if (isAbortError(err) || params.signal?.aborted) {
				throw toAbortError(err);
			}

			if (!looksLikeToolsUnsupported(err)) {
				throw err;
			}

			const fallback = await attempt(false);
			return {
				...fallback,
				toolsFallback: true
			};
		}
	}

	async listModels(params: ListModelsParams = {}): Promise<string[]> {
		const settings = this.getConfig();
		const baseUrl = (params.baseUrl ?? settings.baseUrl).trim();
		if (!baseUrl) {
			throw new Error('Укажите базовый URL');
		}

		const data = await this.requestJson<ModelsListResponse>('/v1/models', {
				method: 'GET',
				signal: params.signal,
			},
			Math.min(settings.requestTimeoutMs, 30_000),
			baseUrl,
		);

		if (data.error?.message) {
			throw new Error(data.error.message);
		}

		const ids = new Set<string>();
		for (const item of data.data ?? []) {
			if (item.id?.trim()) {
				ids.add(item.id.trim());
			}
		}

		for (const item of data.models ?? []) {
			if (typeof item === 'string' && item.trim()) {
				ids.add(item.trim());
				continue;
			}

			if (typeof item === 'object' && item) {
				const id = item.id?.trim() || item.name?.trim();
				if (id) {
					ids.add(id);
				}
			}
		}

		return [...ids].sort((a, b) => a.localeCompare(b));
	}

	private async requestJson<T>(path: string, init: RequestInit, timeoutMs: number, baseUrl: string): Promise<T> {
		const url = new URL(path, baseUrl).toString();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		const onAbort = () => controller.abort();
		if (init.signal) {
			if (init.signal.aborted) {
				controller.abort();
			} else {
				init.signal.addEventListener('abort', onAbort, {
					once: true
				});
			}
		}

		try {
			const response = await fetch(url, {
				...init,
				signal: controller.signal,
			});

			const text = await response.text();
			let parsed: unknown;
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
				throw new Error(`Ошибка HTTP ${response.status}: ${msg}`);
			}

			return (parsed ?? {}) as T;
		} catch (err) {
			if (isAbortError(err) || controller.signal.aborted) {
				throw toAbortError(err);
			}

			if (err instanceof Error) {
				throw err;
			}

			throw new Error(String(err));
		} finally {
			clearTimeout(timer);
			init.signal?.removeEventListener('abort', onAbort);
		}
	}
}

export type { ChatMessage };
