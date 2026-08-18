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

function looksLikeTruncatedToolArgs(err: unknown): boolean {
	const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
	return /parse tool call arguments as json|unterminated string|missing closing quote|invalid_or_truncated_json/.test(msg);
}

function toTruncatedToolArgsError(err: unknown): Error | undefined {
	if (!looksLikeTruncatedToolArgs(err)) {
		return undefined;
	}

	return new Error('Модель вернула битый JSON в tool-call (часто обрезка max_tokens). Увеличь max_tokens в настройках и продолжи файл через apply_patch небольшими кусками.');
}

function looksLikeToolsUnsupported(err: unknown): boolean {
	if (looksLikeTruncatedToolArgs(err)) {
		return false;
	}

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

interface StreamAccum {
	content: string;
	finishReason?: string;
	error?: string;
	calls: Array<{
		id: string;
		name: string;
		arguments: string
	}>;
}

function applyStreamDelta(acc: StreamAccum, parsed: ChatCompletionsResponse, onDelta?: (chunk: string) => void): void {
	if (parsed.error?.message) {
		acc.error = parsed.error.message;
		return;
	}

	const choice = parsed.choices?.[0];
	if (!choice) {
		return;
	}

	if (choice.finish_reason) {
		acc.finishReason = choice.finish_reason;
	}

	const delta = (choice as { 
		delta?: { 
			content?: string | null; 
			tool_calls?: Array<{ 
				index?: number; 
				id?: string; 
				function?: { 
					name?: string; 
					arguments?: string 
				} 
			}> 
		} 
	}).delta ?? choice.message;
	const piece = delta?.content ?? choice.text;
	if (typeof piece === 'string' && piece) {
		acc.content += piece;
		onDelta?.(piece);
	}

	const toolDeltas = (choice as { 
		delta?: { 
			tool_calls?: Array<{ 
				index?: number; 
				id?: string; 
				function?: { 
					name?: string; 
					arguments?: string 
				} 
			}> 
		} 
	}).delta?.tool_calls ?? choice.message?.tool_calls;
	if (!toolDeltas) {
		return;
	}

	for (const [fallbackIndex, tc] of toolDeltas.entries()) {
		const index = typeof (tc as { index?: number }).index === 'number' ? (tc as { index: number }).index : fallbackIndex;
		if (!acc.calls[index]) {
			acc.calls[index] = { 
				id: '', 
				name: '', 
				arguments: '' 
			};
		}

		const slot = acc.calls[index];
		if (tc.id) {
			slot.id = tc.id;
		}

		if (tc.function?.name) {
			slot.name += tc.function.name;
		}

		if (tc.function?.arguments) {
			slot.arguments += tc.function.arguments;
		}
	}
}

function accumToResult(acc: StreamAccum): CompleteResult {
	if (acc.error) {
		throw new Error(acc.error);
	}

	const toolCalls: LlmToolCall[] | undefined = acc.calls.length
		? acc.calls.filter((c) => c.name).map((c, i) => ({
			id: c.id || `call_${i + 1}`,
			type: 'function' as const,
			function: { 
				name: c.name, 
				arguments: c.arguments || '{}' 
			},
		}))
		: undefined;
	if (!acc.content.trim() && !toolCalls?.length) {
		throw new Error('LLM-сервер вернул пустой ответ');
	}

	return {
		content: acc.content,
		toolCalls,
		finishReason: acc.finishReason,
	};
}

export class HttpLlmClient implements LlmClient {
	constructor(private readonly getConfig = getSettings) {}

	async complete(params: CompleteParams): Promise<CompleteResult> {
		const settings = this.getConfig();
		const useTools = Boolean(params.tools?.length) && params.toolChoice !== 'none';

		let streamedAny = false;
		const onDelta = (chunk: string) => {
			streamedAny = true;
			params.onDelta?.(chunk);
		};

		const attempt = async (withTools: boolean, stream: boolean): Promise<CompleteResult> => {
			const body: Record<string, unknown> = {
				model: settings.model,
				messages: params.messages,
				temperature: settings.temperature,
				max_tokens: settings.maxTokens,
				stream,
			};

			if (withTools && params.tools?.length) {
				body.tools = params.tools;
				body.tool_choice = params.toolChoice ?? 'auto';
			}

			if (stream) {
				return this.requestStream(body, params.signal, settings.requestTimeoutMs, settings.baseUrl, onDelta);
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

			if (text && !streamedAny) {
				onDelta(text);
			}

			return {
				content: text,
				toolCalls,
				finishReason: choice?.finish_reason,
			};
		};

		const run = async (withTools: boolean): Promise<CompleteResult> => {
			try {
				return await attempt(withTools, true);
			} catch (err) {
				if (isAbortError(err) || params.signal?.aborted) {
					throw toAbortError(err);
				}
				
				const truncated = toTruncatedToolArgsError(err);
				if (truncated) {
					throw truncated;
				}

				return attempt(withTools, false);
			}
		};

		if (!useTools) {
			return run(false);
		}

		try {
			return await run(true);
		} catch (err) {
			if (isAbortError(err) || params.signal?.aborted) {
				throw toAbortError(err);
			}

			const truncated = toTruncatedToolArgsError(err);
			if (truncated) {
				throw truncated;
			}

			if (!looksLikeToolsUnsupported(err)) {
				throw err;
			}

			const fallback = await run(false);
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

	private async requestStream(
		body: Record<string, unknown>,
		signal: AbortSignal | undefined,
		timeoutMs: number,
		baseUrl: string,
		onDelta?: (chunk: string) => void,
	): Promise<CompleteResult> {
		const url = new URL('/v1/chat/completions', baseUrl).toString();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const onAbort = () => controller.abort();
		if (signal) {
			if (signal.aborted) {
				controller.abort();
			} else {
				signal.addEventListener('abort', onAbort, { once: true });
			}
		}

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			const ctype = response.headers.get('content-type') ?? '';
			if (!response.ok) {
				const text = await response.text();
				let parsed: unknown;
				try {
					parsed = text.trim() ? JSON.parse(text) : undefined;
				} catch {
					parsed = undefined;
				}

				const msg = (parsed as { 
					error?: { 
						message?: string 
					} 
				})?.error?.message ?? text.slice(0, 300) ?? response.statusText;
				throw new Error(`Ошибка HTTP ${response.status}: ${msg}`);
			}

			if (ctype.includes('application/json') && !ctype.includes('event-stream')) {
				const data = await response.json() as ChatCompletionsResponse;
				if (data.error?.message) {
					throw new Error(data.error.message);
				}

				const choice = data.choices?.[0];
				const toolCalls = parseToolCalls(data.choices);
				const content = choice?.message?.content ?? choice?.text ?? '';
				const text = typeof content === 'string' ? content : '';
				if (text) {
					onDelta?.(text);
				}

				if (!text.trim() && !toolCalls?.length) {
					throw new Error('LLM-сервер вернул пустой ответ');
				}

				return { 
					content: text, 
					toolCalls, 
					finishReason: choice?.finish_reason 
				};
			}

			if (!response.body) {
				throw new Error('Стрим без тела ответа');
			}

			const acc: StreamAccum = { content: '', calls: [] };
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n');
				buffer = parts.pop() ?? '';
				for (const line of parts) {
					const trimmed = line.trim();
					if (!trimmed.startsWith('data:')) {
						continue;
					}

					const payload = trimmed.slice(5).trim();
					if (payload === '[DONE]') {
						return accumToResult(acc);
					}

					try {
						applyStreamDelta(acc, JSON.parse(payload) as ChatCompletionsResponse, onDelta);
					} catch {

					}
				}
			}
			return accumToResult(acc);
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
			signal?.removeEventListener('abort', onAbort);
		}
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
