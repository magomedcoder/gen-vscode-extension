import * as assert from 'assert';
import { parseMentions, stripMentions } from '../chat/mentions.js';
import { packContext, type ContextHit } from '../index/contextEngine.js';

suite('parseMentions', () => {
	test('разбирает @file @folder @codebase', () => {
		const text = 'Сравни @file src/a.ts и @folder src/b с @codebase auth';
		const mentions = parseMentions(text);
		assert.strictEqual(mentions.length, 3);
		assert.strictEqual(mentions[0].kind, 'file');
		assert.strictEqual(mentions[0].arg, 'src/a.ts');
		assert.strictEqual(mentions[1].kind, 'folder');
		assert.strictEqual(mentions[1].arg, 'src/b');
		assert.strictEqual(mentions[2].kind, 'codebase');
		assert.strictEqual(mentions[2].arg, 'auth');
	});

	test('stripMentions оставляет вопрос', () => {
		const text = '@file foo.ts как это работает?';
		const mentions = parseMentions(text);
		assert.strictEqual(stripMentions(text, mentions), 'как это работает?');
	});

	test('поддерживает : и backticks', () => {
		const mentions = parseMentions('@file:`src/x.ts` @folder:lib');
		assert.strictEqual(mentions[0].arg, 'src/x.ts');
		assert.strictEqual(mentions[1].arg, 'lib');
	});
});

suite('packContext', () => {
	test('ранжирует по score и обрезает по размеру', () => {
		const hits: ContextHit[] = [
			{ source: 'file', path: 'a.ts', score: 1, snippet: 'aaa' },
			{ source: 'codebase', path: 'b.ts', score: 9, snippet: 'bbb' },
			{ source: 'editor', path: 'c.ts', score: 5, snippet: 'ccc' },
		];
		const pack = packContext(hits, 10_000);
		assert.strictEqual(pack.hits[0].path, 'b.ts');
		assert.ok(pack.text.includes('[codebase]'));
	});
});
