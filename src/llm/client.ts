import { getApiKey, buildAuthHeaders } from '../config/apiKey';
import { getSettings, type GenSettings } from '../config/settings';
import { httpErrorMessage, isAbortError, isRetryableError, LlmHttpError, parseErrorDetail, retryDelayMs, toAbortError, toTimeoutError, isTimeoutError } from './errors';
import { logLlm } from './log';
import { parseUsage } from './usage';
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
	usage?: unknown;
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

const MAX_ATTEMPTS = 4;

export interface HttpLlmClientDeps {
	getConfig?: typeof getSettings;
	readApiKey?: typeof getApiKey;
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
}

function looksLikeTruncatedToolArgs(err: unknown): boolean {
	const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
	return /parse tool call arguments as json|unterminated string|missing closing quote|invalid_or_truncated_json/.test(msg);
}

function toTruncatedToolArgsError(err: unknown): Error | undefined {
	if (!looksLikeTruncatedToolArgs(err)) {
		return undefined;
	}

	return new Error('Модель вернула битый JSON в tool-call (часто обрезка max_tokens). Увеличь max_tokens в настройках и продолжи файл через apply_patch небольшими кусками.', { cause: err instanceof Error ? err : undefined });
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
	usage?: CompleteResult['usage'];
	calls: Array<{
		id: string;
		name: string;
		arguments: string
	}>;
}

function applyStreamDelta(acc: StreamAccum, parsed: ChatCompletionsResponse, onDelta?: (chunk: string) => void): void {
	const usage = parseUsage(parsed.usage);
	if (usage) {
		acc.usage = usage;
	}

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
				arguments: '',
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
				arguments: c.arguments || '{}',
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
		usage: acc.usage,
	};
}

export class HttpLlmClient implements LlmClient {
	private readonly getConfig: typeof getSettings;
	private readonly readApiKey: typeof getApiKey;
	private readonly fetchFn: typeof fetch;
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(deps: HttpLlmClientDeps = {}) {
		this.getConfig = deps.getConfig ?? getSettings;
		this.readApiKey = deps.readApiKey ?? getApiKey;
		this.fetchFn = deps.fetch ?? fetch.bind(globalThis);
		this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	}

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
				body.stream_options = { include_usage: true };
				try {
					return await this.requestStream(body, params.signal, settings, onDelta);
				} catch (err) {
					if (!(err instanceof LlmHttpError) || err.status !== 400) {
						throw err;
					}

					delete body.stream_options;
					return this.requestStream(body, params.signal, settings, onDelta);
				}
			}

			const data = await this.requestJson<ChatCompletionsResponse>('/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				signal: params.signal,
			}, settings);

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
				usage: parseUsage(data.usage),
			};
		};

		const run = async (withTools: boolean): Promise<CompleteResult> => {
			try {
				return await attempt(withTools, true);
			} catch (err) {
				if (isTimeoutError(err)) {
					throw err;
				}

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
				toolsFallback: true,
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
		}, { 
			...settings, 
			baseUrl, 
			requestTimeoutMs: Math.min(settings.requestTimeoutMs, 30_000) 
		});

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

	private async authHeaders(settings: GenSettings): Promise<Record<string, string>> {
		const key = await this.readApiKey();
		return buildAuthHeaders(key, settings.authHeader, settings.authScheme);
	}

	private async withRetry<T>(
		method: string,
		url: string,
		run: () => Promise<{ 
			result: T; 
			status: number 
		}>,
	): Promise<T> {
		let last: unknown;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
			const started = Date.now();
			try {
				const { result, status } = await run();
				logLlm({
					method,
					url,
					status,
					ms: Date.now() - started,
					ok: true,
					attempt,
				});
				return result;
			} catch (err) {
				last = err;
				const status = err instanceof LlmHttpError ? err.status : undefined;
				logLlm({
					method,
					url,
					status,
					ms: Date.now() - started,
					ok: false,
					error: err instanceof Error ? err.message : String(err),
					attempt,
				});
				if (attempt >= MAX_ATTEMPTS || !isRetryableError(err)) {
					throw err;
				}

				await this.sleep(retryDelayMs(attempt - 1));
			}
		}

		throw last;
	}

	private async requestStream(
		body: Record<string, unknown>,
		signal: AbortSignal | undefined,
		settings: GenSettings,
		onDelta?: (chunk: string) => void,
	): Promise<CompleteResult> {
		const url = new URL('/v1/chat/completions', settings.baseUrl).toString();
		const headers = {
			'Content-Type': 'application/json',
			...(await this.authHeaders(settings)),
		};

		return this.withRetry('POST', url, () => this.requestStreamOnce(url, body, headers, signal, settings.requestTimeoutMs, onDelta));
	}

	private async requestStreamOnce(
		url: string,
		body: Record<string, unknown>,
		headers: Record<string, string>,
		signal: AbortSignal | undefined,
		timeoutMs: number,
		onDelta?: (chunk: string) => void,
	): Promise<{ result: CompleteResult; status: number }> {
		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		const onAbort = () => controller.abort();
		if (signal) {
			if (signal.aborted) {
				controller.abort();
			} else {
				signal.addEventListener('abort', onAbort, { once: true });
			}
		}

		try {
			const response = await this.fetchFn(url, {
				method: 'POST',
				headers,
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

				throw new LlmHttpError(httpErrorMessage(response.status, parseErrorDetail(text, parsed, response.statusText)), response.status);
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
					result: {
						content: text,
						toolCalls,
						finishReason: choice?.finish_reason,
						usage: parseUsage(data.usage),
					},
					status: response.status,
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
						return {
							result: accumToResult(acc),
							status: response.status,
						};
					}

					try {
						applyStreamDelta(acc, JSON.parse(payload) as ChatCompletionsResponse, onDelta);
					} catch {
					}
				}
			}
			return {
				result: accumToResult(acc),
				status: response.status,
			};
		} catch (err) {
			if (isAbortError(err) || controller.signal.aborted) {
				if (timedOut && !signal?.aborted) {
					throw toTimeoutError(timeoutMs, err);
				}

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

	private async requestJson<T>(path: string, init: RequestInit, settings: GenSettings): Promise<T> {
		const url = new URL(path, settings.baseUrl).toString();
		const headers = {
			...((init.headers as Record<string, string> | undefined) ?? {}),
			...(await this.authHeaders(settings)),
		};

		return this.withRetry(init.method ?? 'GET', url, () => this.requestJsonOnce<T>(url, { ...init, headers }, init.signal ?? undefined, settings.requestTimeoutMs));
	}

	private async requestJsonOnce<T>(
		url: string,
		init: RequestInit,
		signal: AbortSignal | undefined,
		timeoutMs: number,
	): Promise<{ result: T; status: number }> {
		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);

		const onAbort = () => controller.abort();
		if (signal) {
			if (signal.aborted) {
				controller.abort();
			} else {
				signal.addEventListener('abort', onAbort, {
					once: true,
				});
			}
		}

		try {
			const response = await this.fetchFn(url, {
				...init,
				signal: controller.signal,
			});

			const text = await response.text();
			let parsed: unknown;
			if (text.trim()) {
				try {
					parsed = JSON.parse(text) as unknown;
				} catch (cause) {
					throw new Error(`Некорректный JSON от LLM-сервера (HTTP ${response.status}): ${text.slice(0, 200)}`, { cause: cause instanceof Error ? cause : undefined });
				}
			}

			if (!response.ok) {
				throw new LlmHttpError(httpErrorMessage(response.status, parseErrorDetail(text, parsed, response.statusText)), response.status);
			}

			return {
				result: (parsed ?? {}) as T,
				status: response.status,
			};
		} catch (err) {
			if (isAbortError(err) || controller.signal.aborted) {
				if (timedOut && !signal?.aborted) {
					throw toTimeoutError(timeoutMs, err);
				}

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
}

export type { ChatMessage };
