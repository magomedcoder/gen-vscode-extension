import * as assert from 'assert';
import { addUsage, formatTokenCount, parseUsage, sumUsage } from '../llm/usage.js';

suite('token usage', () => {
	test('читает api usage', () => {
		assert.deepStrictEqual(parseUsage({
			prompt_tokens: 10,
			completion_tokens: 20,
			total_tokens: 30,
		}), {
			promptTokens: 10,
			completionTokens: 20,
			totalTokens: 30,
		});
	});

	test('считает total если его нет', () => {
		assert.strictEqual(parseUsage({
			prompt_tokens: 4,
			completion_tokens: 6,
		})?.totalTokens, 10);
	});

	test('пустой usage - undefined', () => {
		assert.strictEqual(parseUsage({}), undefined);
		assert.strictEqual(parseUsage(undefined), undefined);
	});

	test('складывает сообщения', () => {
		const sum = sumUsage([
			{
				usage: {
					promptTokens: 1,
					completionTokens: 2,
					totalTokens: 3,
				}
			},
			{
				usage: {
					promptTokens: 4,
					completionTokens: 5,
					totalTokens: 9,
				}
			},
		]);
		assert.deepStrictEqual(sum, {
			promptTokens: 5,
			completionTokens: 7,
			totalTokens: 12,
		});
		assert.strictEqual(addUsage(undefined, sum), sum);
	});

	test('формат тысяч', () => {
		assert.strictEqual(formatTokenCount(9999), '9999');
		assert.strictEqual(formatTokenCount(12_300), '12.3k');
	});
});
