import * as assert from 'assert';
import { buildAuthHeaders } from '../config/apiKey';
import { HttpLlmClient } from '../llm/client';
import { isRetryableError, LlmHttpError, retryDelayMs, withCause } from '../llm/errors';
import type { GenSettings } from '../config/types';
import { DEFAULT_SETTINGS } from '../config/types';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function testSettings(over: Partial<GenSettings> = {}): GenSettings {
	return {
		...DEFAULT_SETTINGS,
		baseUrl: 'http://llm.test',
		model: 'test',
		requestTimeoutMs: 5_000,
		...over,
	};
}

suite('buildAuthHeaders', () => {
	test('Bearer по умолчанию', () => {
		assert.deepStrictEqual(buildAuthHeaders('sk-1', 'Authorization', 'Bearer'), {
			Authorization: 'Bearer sk-1',
		});
	});

	test('пустой ключ - нет заголовка', () => {
		assert.deepStrictEqual(buildAuthHeaders('', 'Authorization', 'Bearer'), {});
	});

	test('без схемы - сырой ключ', () => {
		assert.deepStrictEqual(buildAuthHeaders('raw', 'X-Api-Key', ''), {
			'X-Api-Key': 'raw',
		});
	});
});

suite('retry helpers', () => {
	test('429 и 5xx повторяются', () => {
		assert.ok(isRetryableError(new LlmHttpError('x', 429)));
		assert.ok(isRetryableError(new LlmHttpError('x', 503)));
		assert.ok(!isRetryableError(new LlmHttpError('x', 400)));
		assert.ok(isRetryableError(new TypeError('fetch failed')));
	});

	test('backoff растёт', () => {
		assert.strictEqual(retryDelayMs(0), 400);
		assert.strictEqual(retryDelayMs(1), 800);
		assert.strictEqual(retryDelayMs(2), 1600);
	});

	test('withCause сохраняет cause', () => {
		const root = new Error('root');
		const wrapped = withCause('outer', root);
		assert.strictEqual(wrapped.cause, root);
	});
});

suite('HttpLlmClient', () => {
	test('повторяет 503 и затем успех', async () => {
		const calls: number[] = [];
		const client = new HttpLlmClient({
			getConfig: () => testSettings(),
			readApiKey: async () => 'sk-test',
			sleep: async () => undefined,
			fetch: async (_url, init) => {
				calls.push(1);
				const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
				assert.strictEqual(auth, 'Bearer sk-test');
				if (calls.length === 1) {
					return jsonResponse({
						error: {
							message: 'busy'
						}
					}, 503);
				}

				return jsonResponse({
					data: [{
						id: 'gpt'
					}]
				});
			},
		});

		const models = await client.listModels();
		assert.deepStrictEqual(models, ['gpt']);
		assert.strictEqual(calls.length, 2);
	});

	test('400 не ретраится', async () => {
		let calls = 0;
		const client = new HttpLlmClient({
			getConfig: () => testSettings(),
			readApiKey: async () => '',
			sleep: async () => undefined,
			fetch: async () => {
				calls += 1;
				return jsonResponse({
					error: {
						message: 'bad'
					}
				}, 400);
			},
		});

		await assert.rejects(
			() => client.listModels(),
			(err: unknown) => err instanceof LlmHttpError && err.status === 400 && /HTTP 400/.test(err.message),
		);
		assert.strictEqual(calls, 1);
	});
});
