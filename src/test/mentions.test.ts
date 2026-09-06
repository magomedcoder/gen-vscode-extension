import * as assert from 'assert';
import { parseMentions, stripMentions } from '../features/chat/mentions.js';
import { packContext, type ContextHit } from '../features/index/contextEngine.js';

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

	test('разбирает @code @Docs @agent без поломки @codebase', () => {
		const text = '@codebase auth и @code плюс @Docs guide и @agent scout';
		const mentions = parseMentions(text);
		assert.strictEqual(mentions.length, 4);
		assert.strictEqual(mentions[0].kind, 'codebase');
		assert.strictEqual(mentions[0].arg, 'auth');
		assert.strictEqual(mentions[1].kind, 'code');
		assert.strictEqual(mentions[2].kind, 'docs');
		assert.strictEqual(mentions[2].arg, 'guide');
		assert.strictEqual(mentions[3].kind, 'agent');
		assert.strictEqual(mentions[3].arg, 'scout');
	});

	test('разбирает @terminals', () => {
		const text = 'смотри @terminals что упало';
		const mentions = parseMentions(text);
		assert.strictEqual(mentions.length, 1);
		assert.strictEqual(mentions[0].kind, 'terminals');
		assert.strictEqual(stripMentions(text, mentions), 'смотри что упало');
	});

	test('разбирает @past и @past с заголовком', () => {
		const text = 'сравни @past:abc123 и @past `Fix auth` плюс @past';
		const mentions = parseMentions(text);
		assert.strictEqual(mentions.length, 3);
		assert.strictEqual(mentions[0].kind, 'past');
		assert.strictEqual(mentions[0].arg, 'abc123');
		assert.strictEqual(mentions[1].kind, 'past');
		assert.strictEqual(mentions[1].arg, 'Fix auth');
		assert.strictEqual(mentions[2].kind, 'past');
		assert.strictEqual(mentions[2].arg, undefined);
		assert.strictEqual(stripMentions(text, mentions), 'сравни и плюс');
	});

	test('разбирает @alias и @ref без поломки других mentions', () => {
		const text = 'смотри @alias sdk и @ref:upstream плюс @file src/a.ts';
		const mentions = parseMentions(text);
		assert.strictEqual(mentions.length, 3);
		assert.strictEqual(mentions[0].kind, 'alias');
		assert.strictEqual(mentions[0].arg, 'sdk');
		assert.strictEqual(mentions[1].kind, 'ref');
		assert.strictEqual(mentions[1].arg, 'upstream');
		assert.strictEqual(mentions[2].kind, 'file');
		assert.strictEqual(mentions[2].arg, 'src/a.ts');
		assert.strictEqual(stripMentions(text, mentions), 'смотри и плюс');
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
