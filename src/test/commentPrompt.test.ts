import * as assert from 'assert';
import { buildCommentMessages } from '../prompt/commentPrompt.js';
import { pickFewShot } from '../prompt/commentFewShot.js';

suite('pickFewShot', () => {
	test('typescript использует js-style пример', () => {
		const shot = pickFewShot('typescript');
		assert.strictEqual(shot.languageId, 'javascript');
		assert.ok(shot.userCode.includes('function canWrite'));
	});

	test('python использует hash-style пример', () => {
		const shot = pickFewShot('python');
		assert.strictEqual(shot.languageId, 'python');
		assert.ok(shot.userCode.includes('def can_write'));
	});

	test('html использует html-style пример', () => {
		const shot = pickFewShot('html');
		assert.strictEqual(shot.languageId, 'html');
		assert.ok(shot.userCode.includes('<section>'));
	});
});

suite('buildCommentMessages', () => {
	const textOf = (content: string | Array<{ type: string; text?: string }>): string => {
		if (typeof content === 'string') {
			return content;
		}
		return content.map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join('');
	};

	test('подмешивает custom system prompt', () => {
		const messages = buildCommentMessages({
			languageId: 'typescript',
			fileName: 'a.ts',
			code: 'const x = 1;',
			commentStyle: 'inline',
			commentSystemPrompt: 'Комментируй только публичные API.',
		});

		const system = messages.find((m) => m.role === 'system');
		assert.ok(system && system.role === 'system');
		assert.ok(textOf(system.content as string | Array<{ type: string; text?: string }>).includes('Комментируй только публичные API.'));
	});

	test('few-shot соответствует языку файла', () => {
		const messages = buildCommentMessages({
			languageId: 'python',
			fileName: 'main.py',
			code: 'x = 1',
			commentStyle: 'inline',
			commentSystemPrompt: '',
		});

		assert.strictEqual(messages[1]?.role, 'user');
		assert.strictEqual(messages[3]?.role, 'user');
		assert.ok(textOf(messages[1]!.content as string | Array<{ type: string; text?: string }>).includes('Язык: python'));
		assert.ok(textOf(messages[3]!.content as string | Array<{ type: string; text?: string }>).includes('Язык: python'));
		assert.ok(textOf(messages[3]!.content as string | Array<{ type: string; text?: string }>).includes('main.py'));
	});
});
