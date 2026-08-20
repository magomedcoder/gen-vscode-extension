import * as assert from 'assert';
import { extractCommentedCode } from '../parse/extractCommentedCode';
import { resolveCommentStyleId, stripComments, validateUnchangedCode } from '../parse/validateUnchangedCode';

suite('extractCommentedCode', () => {
	test('извлекает содержимое markdown-блока', () => {
		const raw = 'Вот код:\n```ts\nconst x = 1;\n```\n';
		assert.strictEqual(extractCommentedCode(raw), 'const x = 1;');
	});

	test('возвращает сырой текст без ограждения', () => {
		assert.strictEqual(extractCommentedCode('const x = 1;'), 'const x = 1;');
	});

	test('берёт последний fenced block при нескольких', () => {
		const raw = '```js\nold\n```\n\n```ts\nconst x = 1;\n```';
		assert.strictEqual(extractCommentedCode(raw), 'const x = 1;');
	});

	test('пустой fenced block -> пустая строка', () => {
		assert.strictEqual(extractCommentedCode('```\n```'), '');
	});
});

suite('resolveCommentStyleId', () => {
	test('маппит известные languageId на семейства', () => {
		assert.strictEqual(resolveCommentStyleId('typescript'), 'tsStyle');
		assert.strictEqual(resolveCommentStyleId('python'), 'hash');
		assert.strictEqual(resolveCommentStyleId('html'), 'html');
		assert.strictEqual(resolveCommentStyleId('sql'), 'sql');
		assert.strictEqual(resolveCommentStyleId('lua'), 'lua');
		assert.strictEqual(resolveCommentStyleId('php'), 'php');
	});

	test('неизвестный язык -> tsStyle fallback', () => {
		assert.strictEqual(resolveCommentStyleId('unknown-lang'), 'tsStyle');
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

	test('python: # и строки не ломаются', () => {
		const original = 'def add(a, b):\n    return a + b\n';
		const commented = 'def add(a, b):\n    # сумма\n    return a + b  # хвост\n';
		assert.strictEqual(validateUnchangedCode(original, commented, 'python').ok, true);

		const withHashInString = 'x = "# not comment"\n';
		assert.ok(stripComments(withHashInString, 'python').includes('# not comment'));
	});

	test('shell: # комментарии', () => {
		const original = 'echo hello\n';
		const commented = '# greet\necho hello\n';
		assert.strictEqual(validateUnchangedCode(original, commented, 'shellscript').ok, true);
	});

	test('html: <!-- -->', () => {
		const original = '<div>Hi</div>\n';
		const commented = '<!-- title -->\n<div>Hi</div>\n';
		assert.strictEqual(validateUnchangedCode(original, commented, 'html').ok, true);
	});

	test('sql: -- и /* */', () => {
		const original = 'SELECT 1;\n';
		const commented = '-- q\nSELECT 1; /* ok */\n';
		assert.strictEqual(validateUnchangedCode(original, commented, 'sql').ok, true);

		const str = "SELECT 'it''s';\n";
		assert.ok(stripComments(str, 'sql').includes("it''s"));
	});

	test('lua: -- и --[[ ]]', () => {
		const original = 'local x = 1\n';
		const commented = '-- note\nlocal x = 1\n--[[ block ]]\n';
		assert.strictEqual(validateUnchangedCode(original, commented, 'lua').ok, true);
	});

	test('php: // # и /* */', () => {
		const original = 'echo 1;\n';
		const commented = '// a\n# b\necho 1; /* c */\n';
		assert.strictEqual(validateUnchangedCode(original, commented, 'php').ok, true);
	});

	test('ruby: =begin/=end', () => {
		const original = 'puts 1\n';
		const commented = '=begin\nnote\n=end\nputs 1\n';
		assert.strictEqual(validateUnchangedCode(original, commented, 'ruby').ok, true);
	});
});
