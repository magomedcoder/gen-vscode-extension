import * as assert from 'assert';
import { DEFAULT_SETTINGS } from '../core/config/types.js';
import { clearCachedNCtx, getCachedNCtx, getEffectiveContextBudget, setCachedNCtx, softCacheNCtxFromCompletePayload } from '../core/llm/contextBudget.js';
import { isContextOverflowError, parseContextOverflow } from '../core/llm/contextOverflow.js';
import { LlmHttpError } from '../core/llm/errors.js';
import { estimateChatMessagesTokens, estimateTextTokens } from '../core/llm/estimateTokens.js';
import { completeWithContextGuard, dedupToolResults, dropSupersededReminders, pruneToolToDigest, recentToolKeepCount, shrinkApiMessages, softCompactApiMessages } from '../features/chat/fitContext.js';
import type { ChatMessage, CompleteResult, LlmClient } from '../core/llm/types.js';
import { extractNCtxFromModelsPayload, extractNCtxFromProps } from '../core/llm/contextBudget.js';

suite('context overflow parse', () => {
	const nestedEngine = [
		'HTTP error 400: ',
		'{"error":"Engine protocol predict request returned 400: ',
		'{\\"error\\":{\\"code\\":400,\\"message\\":\\"request (8774 tokens) exceeds the available ',
		'context size (8192 tokens), try increasing it\\",\\"type\\":\\"exceed_context_size_error\\",',
		'\\"n_prompt_tokens\\":8774,\\"n_ctx\\":8192}}"}',
	].join('');

	test('парсит nested llama.cpp exceed_context_size_error', () => {
		const err = new LlmHttpError(nestedEngine, 400);
		const info = parseContextOverflow(err);
		assert.ok(info);
		assert.strictEqual(info!.nPromptTokens, 8774);
		assert.strictEqual(info!.nCtx, 8192);
		assert.ok(isContextOverflowError(err));
	});

	test('не путает обычный 400', () => {
		const err = new LlmHttpError('HTTP error 400: {"error":{"message":"invalid json"}}', 400);
		assert.strictEqual(parseContextOverflow(err), undefined);
		assert.strictEqual(isContextOverflowError(err), false);
	});

	test('не трогает 429', () => {
		const err = new LlmHttpError('rate limit', 429);
		assert.strictEqual(parseContextOverflow(err), undefined);
	});
});

suite('context budget', () => {
	test('effective budget учитывает maxTokens и n_ctx', () => {
		const settings = {
			...DEFAULT_SETTINGS,
			maxContextTokens: 128_000,
			maxTokens: 2048,
			compactReservedTokens: 0,
		};
		const withCtx = getEffectiveContextBudget(settings, 8192);
		assert.ok(withCtx < 8192);
		assert.ok(withCtx >= 1024);
		const without = getEffectiveContextBudget(settings);
		assert.ok(without > withCtx);
	});

	test('n_ctx cache по baseUrl+model', () => {
		clearCachedNCtx();
		setCachedNCtx('http://127.0.0.1:8080', 'local', 8192);
		assert.strictEqual(getCachedNCtx('http://127.0.0.1:8080', 'local'), 8192);
		assert.strictEqual(getCachedNCtx('http://other', 'local'), undefined);
		clearCachedNCtx();
	});

	test('softCacheNCtxFromCompletePayload читает n_ctx из usage/корня', () => {
		clearCachedNCtx();
		softCacheNCtxFromCompletePayload('http://127.0.0.1:8080', 'local', {
			usage: { 
				prompt_tokens: 100, 
				n_ctx: 4096 
			},
		});
		assert.strictEqual(getCachedNCtx('http://127.0.0.1:8080', 'local'), 4096);
		clearCachedNCtx();
	});
});

suite('estimate + shrink', () => {
	test('estimateTextTokens растёт с длиной', () => {
		assert.ok(estimateTextTokens('abcd') >= 1);
		assert.ok(estimateTextTokens('a'.repeat(400)) > estimateTextTokens('a'.repeat(40)));
	});

	test('shrinkApiMessages ужимает tool content', () => {
		const huge = 'x'.repeat(50_000);
		const messages: ChatMessage[] = [
			{ 
				role: 'system', 
				content: 'sys' 
			},
			{ 
				role: 'user', 
				content: 'hi' 
			},
			{ 
				role: 'assistant', 
				content: null, 
				tool_calls: [{ 
					id: '1', 
					type: 'function', 
					function: { 
						name: 'read_file', 
						arguments: '{}' 
					} 
				}] 
			},
			{ 
				role: 'tool', 
				tool_call_id: '1', 
				content: huge 
			},
		];
		const budget = 2000;
		const { messages: out, changed } = shrinkApiMessages(messages, budget, {
			...DEFAULT_SETTINGS,
			toolOutputMaxChars: 12_000,
			maxInputChars: 8000,
		});
		assert.ok(changed);
		const tool = out.find((m) => m.role === 'tool');
		assert.ok(tool && tool.role === 'tool');
		assert.ok(tool.content.length < huge.length);
		assert.ok(estimateChatMessagesTokens(out) <= estimateChatMessagesTokens(messages));
	});

	test('recentToolKeepCount берёт compactTailTurns', () => {
		assert.strictEqual(recentToolKeepCount({ 
			...DEFAULT_SETTINGS, 
			compactTailTurns: 4 
		}), 4);
		assert.strictEqual(recentToolKeepCount({ 
			...DEFAULT_SETTINGS, 
			compactTailTurns: 6 
		}), 6);
	});

	test('pruneToolToDigest оставляет превью и was N chars', () => {
		const body = 'path=/tmp/a.ts\n' + 'z'.repeat(500);
		const dig = pruneToolToDigest(body);
		assert.ok(dig.includes('[pruned tool result]'));
		assert.ok(dig.includes(`was ${body.length} chars`));
		assert.ok(dig.length < body.length);
	});

	test('shrinkApiMessages: старые tool -> digest, последние N - с cap', () => {
		const keep = 4;
		const messages: ChatMessage[] = [
			{ 
				role: 'system', 
				content: 'sys' 
			},
			{ 
				role: 'user', 
				content: 'start' 
			},
		];
		for (let i = 0; i < 6; i += 1) {
			const id = String(i + 1);
			messages.push({
				role: 'assistant',
				content: null,
				tool_calls: [{ 
					id, 
					type: 'function', 
					function: { 
						name: 'read_file', 
						arguments: '{}' 
					} 
				}],
			});
			messages.push({
				role: 'tool',
				tool_call_id: id,
				content: `TOOL_${i}_` + 'x'.repeat(8_000),
			});
		}
		messages.push({ 
			role: 'user', 
			content: 'last user question please keep' 
		});

		const { messages: out, changed } = shrinkApiMessages(messages, 50_000, {
			...DEFAULT_SETTINGS,
			compactTailTurns: keep,
			toolOutputMaxChars: 12_000,
			maxInputChars: 8000,
		});
		assert.ok(changed);

		const tools = out.filter((m) => m.role === 'tool');
		assert.strictEqual(tools.length, 6);
		const oldTools = tools.slice(0, tools.length - keep);
		const recentTools = tools.slice(tools.length - keep);
		for (const t of oldTools) {
			assert.ok(t.role === 'tool' && t.content.includes('[pruned tool result]'), t.content.slice(0, 120));
		}
		for (const t of recentTools) {
			assert.ok(t.role === 'tool' && !t.content.includes('[pruned tool result]'));
			assert.ok(t.content.length > 400);
			assert.ok(t.content.length < 8_000 + 20);
		}

		const lastUser = [...out].reverse().find((m) => m.role === 'user');
		assert.ok(lastUser && lastUser.role === 'user');
		assert.strictEqual(lastUser.content, 'last user question please keep');
	});

	test('shrinkApiMessages не удаляет last user при middle drop', () => {
		const messages: ChatMessage[] = [
			{ 
				role: 'system', 
				content: 'sys plan active' 
			},
			{ 
				role: 'user', 
				content: 'u0' 
			},
			{ 
				role: 'assistant', 
				content: 'a0 '.repeat(2_000) 
			},
			{ 
				role: 'user', 
				content: 'u1' },
			{ 
				role: 'assistant', 
				content: 'a1 '.repeat(2_000) 
			},
			{ 
				role: 'user', 
				content: 'MUST_KEEP_LAST_USER' 
			},
			{ 
				role: 'assistant', 
				content: 'a2 '.repeat(2_000) 
			},
		];
		const { messages: out } = shrinkApiMessages(messages, 800, {
			...DEFAULT_SETTINGS,
			toolOutputMaxChars: 12_000,
			maxInputChars: 8000,
		});
		assert.strictEqual(out[0]?.role, 'system');
		const users = out.filter((m) => m.role === 'user');
		assert.ok(users.some((m) => m.role === 'user' && m.content === 'MUST_KEEP_LAST_USER'));
	});

	test('shrinkApiMessages возвращает prunedChars / prunedMessages', () => {
		const huge = 'x'.repeat(20_000);
		const messages: ChatMessage[] = [
			{ 
				role: 'system', 
				content: 'sys' 
			},
			{ 
				role: 'user', 
				content: 'hi' 
			},
			{ 
				role: 'assistant', 
				content: null, 
				tool_calls: [{ 
					id: '1', 
					type: 'function', 
					function: { 
						name: 'read_file', 
						arguments: '{}' 
					} 
				}] 
			},
			{ 
				role: 'tool', 
				tool_call_id: '1', 
				content: huge 
			},
		];
		const out = shrinkApiMessages(messages, 500, {
			...DEFAULT_SETTINGS,
			toolOutputMaxChars: 12_000,
			maxInputChars: 8000,
		});
		assert.ok(out.changed);
		assert.ok(out.prunedChars > 0);
		assert.ok(out.prunedMessages >= 1);
	});

	test('dedupToolResults заменяет повторный read_file того же path', () => {
		const body = 'path=src/a.ts\n' + 'line\n'.repeat(200);
		const messages: ChatMessage[] = [
			{ 
				role: 'system', 
				content: 'sys' 
			},
			{ 
				role: 'assistant', 
				content: null, 
				tool_calls: [
					{ 
						id: '1', 
						type: 'function', 
						function: { 
							name: 'read_file', 
							arguments: '{"path":"src/a.ts"}' 
						} 
					},
				]
			},
			{ 
				role: 'tool', 
				tool_call_id: '1', 
				name: 'read_file', 
				content: body 
			},
			{ 
				role: 'assistant', 
				content: null, 
				tool_calls: [
					{ 
						id: '2', 
						type: 'function', 
						function: { 
							name: 'read_file', 
							arguments: '{"path":"src/a.ts"}' 
						} 
					},
				] 
			},
			{ 
				role: 'tool', 
				tool_call_id: '2', 
				name: 'read_file', 
				content: body 
			},
		];
		const { messages: out, changed } = dedupToolResults(messages);
		assert.ok(changed);
		const tools = out.filter((m) => m.role === 'tool');
		assert.strictEqual(tools.length, 2);
		assert.ok(tools[0]!.role === 'tool' && !tools[0]!.content.includes('duplicate tool result'));
		assert.ok(tools[1]!.role === 'tool' && tools[1]!.content.includes('earlier #1'));
	});

	test('dropSupersededReminders оставляет только последний mode reminder', () => {
		const messages: ChatMessage[] = [
			{ 
				role: 'system', 
				content: 'sys' 
			},
			{ 
				role: 'assistant', 
				content: 'Режим Plan включён. old' 
			},
			{ 
				role: 'user', 
				content: 'hi' 
			},
			{ 
				role: 'assistant', 
				content: 'Режим Agent включён. mid' 
			},
			{ 
				role: 'user', 
				content: 'again' 
			},
			{ 
				role: 'assistant', 
				content: 'Режим Plan включён. latest' 
			},
		];
		const { messages: out, changed, prunedMessages } = dropSupersededReminders(messages);
		assert.ok(changed);
		assert.ok(prunedMessages >= 1);
		const plans = out.filter((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Режим Plan'));
		assert.strictEqual(plans.length, 1);
		assert.ok(typeof plans[0]!.content === 'string' && plans[0]!.content.includes('latest'));
	});

	test('softCompactApiMessages сжимает старые ходы без LLM', () => {
		const messages: ChatMessage[] = [
			{ 
				role: 'system', 
				content: 'sys' 
			},
		];

		for (let i = 0; i < 6; i += 1) {
			messages.push({ 
				role: 'user', 
				content: `u${i}` 
			});
			messages.push({ 
				role: 'assistant', 
				content: `a${i} `.repeat(500) 
			});
		}
		const { messages: out, changed, prunedMessages } = softCompactApiMessages(messages, {
			...DEFAULT_SETTINGS,
			compactTailTurns: 2,
		});
		assert.ok(changed);
		assert.ok(prunedMessages > 0);
		assert.ok(out.some((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('[mid-loop compact]')));
		assert.ok(out.some((m) => m.role === 'user' && m.content === 'u5'));
	});

	test('extractNCtxFromProps / models metadata', () => {
		assert.strictEqual(extractNCtxFromProps({ 
			default_generation_settings: { 
				n_ctx: 8192 
			} 
		}), 8192);
		assert.strictEqual(extractNCtxFromProps({ 
			n_ctx: 4096 
		}), 4096);
		assert.strictEqual(extractNCtxFromProps({}), undefined);
		assert.strictEqual(
			extractNCtxFromModelsPayload({
				data: [{ 
					id: 'local', 
					meta: { 
						n_ctx_train: 16_384 
					}
				}],
			}, 'local'),
			16_384,
		);
	});
});

suite('completeWithContextGuard retry', () => {
	test('mock 400 overflow -> shrink -> 200 success', async () => {
		clearCachedNCtx();
		const overflowBody = [
			'HTTP error 400: ',
			'{"error":{"code":400,"message":"request (9000 tokens) exceeds the available ',
			'context size (8192 tokens), try increasing it","type":"exceed_context_size_error",',
			'"n_prompt_tokens":9000,"n_ctx":8192}}',
		].join('');

		let calls = 0;
		const statuses: string[] = [];
		let stored: ChatMessage[] = [
			{ 
				role: 'system', 
				content: 'sys' 
			},
			{ 
				role: 'user', 
				content: 'hello' 
			},
			{
				role: 'assistant',
				content: null,
				tool_calls: [{ 
					id: '1', 
					type: 'function', 
					function: { 
						name: 'read_file', 
						arguments: '{}' 
					} 
				}],
			},
			{ 
				role: 'tool', 
				tool_call_id: '1', 
				content: 'payload '.repeat(3_000) 
			},
			{ 
				role: 'user', 
				content: 'continue' 
			},
		];

		const fakeClient = {} as LlmClient;
		const result = await completeWithContextGuard({
			client: fakeClient,
			settings: {
				...DEFAULT_SETTINGS,
				baseUrl: 'http://127.0.0.1:18080',
				model: 'local-test',
				contextOverflowPolicy: 'auto_compact_retry',
				maxContextTokens: 128_000,
				maxTokens: 512,
				compactReservedTokens: 0,
				toolOutputMaxChars: 12_000,
				maxInputChars: 8000,
				compactTailTurns: 4,
			},
			getMessages: () => stored,
			setMessages: (next) => {
				stored = next;
			},
			complete: async (): Promise<CompleteResult> => {
				calls += 1;
				if (calls === 1) {
					throw new LlmHttpError(overflowBody, 400);
				}

				return { content: 'ok-after-retry', finishReason: 'stop' };
			},
			onStatus: (detail) => {
				statuses.push(detail);
			},
		});

		assert.strictEqual(calls, 2);
		assert.strictEqual(result.content, 'ok-after-retry');
		assert.strictEqual(getCachedNCtx('http://127.0.0.1:18080', 'local-test'), 8192);
		assert.ok(statuses.length >= 1);
		clearCachedNCtx();
	});
});
