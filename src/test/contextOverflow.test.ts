import * as assert from 'assert';
import { DEFAULT_SETTINGS } from '../core/config/types.js';
import { clearCachedNCtx, getCachedNCtx, getEffectiveContextBudget, setCachedNCtx } from '../core/llm/contextBudget.js';
import { isContextOverflowError, parseContextOverflow } from '../core/llm/contextOverflow.js';
import { LlmHttpError } from '../core/llm/errors.js';
import { estimateChatMessagesTokens, estimateTextTokens } from '../core/llm/estimateTokens.js';
import { shrinkApiMessages } from '../features/chat/fitContext.js';
import type { ChatMessage } from '../core/llm/types.js';

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
});

suite('estimate + shrink', () => {
	test('estimateTextTokens растёт с длиной', () => {
		assert.ok(estimateTextTokens('abcd') >= 1);
		assert.ok(estimateTextTokens('a'.repeat(400)) > estimateTextTokens('a'.repeat(40)));
	});

	test('shrinkApiMessages ужимает tool content', () => {
		const huge = 'x'.repeat(50_000);
		const messages: ChatMessage[] = [
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
			{ role: 'tool', tool_call_id: '1', content: huge },
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
});
