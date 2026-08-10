import * as assert from 'assert';
import { extractCommentedCode } from '../parse/extractCommentedCode';
import { stripComments, validateUnchangedCode } from '../parse/validateUnchangedCode';

suite('extractCommentedCode', () => {
	test('извлекает содержимое markdown-блока', () => {
		const raw = 'Вот код:\n```ts\nconst x = 1;\n```\n';
		assert.strictEqual(extractCommentedCode(raw), 'const x = 1;');
	});

	test('возвращает сырой текст без ограждения', () => {
		assert.strictEqual(extractCommentedCode('const x = 1;'), 'const x = 1;');
	});
});

suite('validateUnchangedCode', () => {
	test('проходит, если добавлены только комментарии (js)', () => {
		const original = 'function add(a, b) {\n  return a + b;\n}';
		const commented = 'function add(a, b) {\n  // сумма двух чисел\n  return a + b;\n}';
		const result = validateUnchangedCode(original, commented, 'javascript');
		assert.strictEqual(result.ok, true);
	});

	test('падает, если изменилась логика', () => {
		const original = 'function add(a, b) {\n  return a + b;\n}';
		const commented = 'function add(a, b) {\n  // сумма\n  return a - b;\n}';
		const result = validateUnchangedCode(original, commented, 'javascript');
		assert.strictEqual(result.ok, false);
	});

	test('снимает комментарии TypeScript', () => {
		const code = 'function f(x: number) {\n  // заметка\n  return x; // хвост\n}\n';
		assert.strictEqual(stripComments(code, 'typescript').replace(/\s+/g, ' ').trim(), 'function f(x: number) { return x; }');
	});
});
