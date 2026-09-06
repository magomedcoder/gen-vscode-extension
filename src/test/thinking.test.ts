import * as assert from 'assert';
import { extractThinkingDelta, splitAssistantPayload } from '../llm/thinking.js';

suite('llm thinking parse', () => {
	test('reasoning_content из delta', () => {
		assert.strictEqual(
			extractThinkingDelta({ reasoning_content: 'step 1' }),
			'step 1',
		);
	});

	test('reasoning строка и nested object', () => {
		assert.strictEqual(extractThinkingDelta({ reasoning: 'r' }), 'r');
		assert.strictEqual(
			extractThinkingDelta({ reasoning: { content: 'nested' } }),
			'nested',
		);
	});

	test('thinking из content[]', () => {
		assert.strictEqual(
			extractThinkingDelta({
				content: [
					{ type: 'thinking', thinking: 'why' },
					{ type: 'text', text: 'answer' },
				],
			}),
			'why',
		);
	});

	test('splitAssistantPayload разделяет text и thinking', () => {
		const split = splitAssistantPayload({
			reasoning_content: 'think',
			content: 'hello',
		});
		assert.strictEqual(split.content, 'hello');
		assert.strictEqual(split.thinking, 'think');
	});

	test('splitAssistantPayload: content[] Anthropic-like', () => {
		const split = splitAssistantPayload({
			content: [
				{ type: 'thinking', thinking: 'plan' },
				{ type: 'text', text: 'done' },
			],
		});
		assert.strictEqual(split.content, 'done');
		assert.strictEqual(split.thinking, 'plan');
	});

	test('без thinking - пусто', () => {
		assert.strictEqual(extractThinkingDelta({ content: 'only text' }), '');
		assert.deepStrictEqual(splitAssistantPayload({ content: 'x' }), {
			content: 'x',
			thinking: '',
		});
	});
});
