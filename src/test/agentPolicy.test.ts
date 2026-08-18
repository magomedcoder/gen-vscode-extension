import * as assert from 'assert';
import * as path from 'node:path';
import { applySearchReplace, PatchError } from '../agent/patch';
import { assertAllowedPath, isDeniedRelativePath, pathIsInside, resolveAgainstFolders } from '../agent/policy';
import { parseWorkspaceEdits } from '../agent/tools/applyWorkspaceEdit';
import { assertAllowedCommand, CommandPolicyError, formatCommandLine } from '../agent/commandPolicy';
import { formatMiniDiff, pathFromToolArguments } from '../agent/diff';
import { redactSecrets } from '../agent/secrets';
import { parseToolArguments, sanitizeToolArgumentsForApi } from '../agent/types';

suite('path sandbox', () => {
	const root = path.resolve('/tmp/ws');

	test('относительный путь остаётся в workspace', () => {
		const { fsPath, folder } = resolveAgainstFolders('src/a.ts', [root]);
		assert.strictEqual(folder, root);
		assert.ok(pathIsInside(fsPath, root));
		assert.strictEqual(assertAllowedPath(fsPath, folder), 'src/a.ts');
	});

	test('выход через .. запрещён', () => {
		assert.throws(() => resolveAgainstFolders('../secret', [root]));
	});

	test('node_modules, .env и ключи запрещены', () => {
		assert.ok(isDeniedRelativePath('node_modules/pkg/index.js'));
		assert.ok(isDeniedRelativePath('.env'));
		assert.ok(isDeniedRelativePath('app/.env.local'));
		assert.ok(isDeniedRelativePath('certs/server.pem'));
		assert.ok(isDeniedRelativePath('.git/config'));
		assert.ok(!isDeniedRelativePath('src/index.ts'));
	});
});

suite('applySearchReplace', () => {
	test('одна замена', () => {
		const result = applySearchReplace('привет мир', 'мир', 'че там', false);
		assert.strictEqual(result.text, 'привет че там');
		assert.strictEqual(result.count, 1);
	});

	test('несколько вхождений без replace_all - ошибка', () => {
		assert.throws(
			() => applySearchReplace('a x a', 'a', 'b', false),
			(err: unknown) => err instanceof PatchError,
		);
	});

	test('replace_all заменяет все', () => {
		const result = applySearchReplace('a x a', 'a', 'b', true);
		assert.strictEqual(result.text, 'b x b');
		assert.strictEqual(result.count, 2);
	});

	test('фрагмент не найден', () => {
		assert.throws(() => applySearchReplace('abc', 'zzz', 'q', false));
	});
});

suite('parseWorkspaceEdits', () => {
	test('разбирает массив правок', () => {
		const edits = parseWorkspaceEdits({
			edits: [
				{
					path: 'a.ts',
					old_string: 'foo',
					new_string: 'bar'
				},
				{
					path: 'b.ts',
					old_string: 'x',
					new_string: 'y',
					replace_all: true
				},
			],
		});
		assert.strictEqual(edits.length, 2);
		assert.strictEqual(edits[0].path, 'a.ts');
		assert.strictEqual(edits[1].replace_all, true);
	});

	test('пустой или не массив - []', () => {
		assert.deepStrictEqual(parseWorkspaceEdits({}), []);
		assert.deepStrictEqual(parseWorkspaceEdits({ edits: 'nope' }), []);
	});
});

suite('formatMiniDiff', () => {
	test('одинаковый текст - пусто', () => {
		assert.strictEqual(formatMiniDiff('a\nb', 'a\nb'), '');
	});

	test('показывает контекст и +/- строки', () => {
		const diff = formatMiniDiff('keep\nold\nkeep2', 'keep\nnew\nkeep2');
		assert.ok(diff.includes(' keep'));
		assert.ok(diff.includes('-old'));
		assert.ok(diff.includes('+new'));
	});

	test('обрезает длинный diff', () => {
		const before = Array.from({ length: 120 }, (_, i) => `L${i}`).join('\n');
		const after = Array.from({ length: 120 }, (_, i) => `R${i}`).join('\n');
		const diff = formatMiniDiff(before, after);
		assert.ok(diff.includes('строк скрыто'));
		assert.ok(diff.split('\n').length <= 82);
	});
});

suite('pathFromToolArguments', () => {
	test('берёт path', () => {
		assert.strictEqual(pathFromToolArguments('{"path":"src/a.ts"}'), 'src/a.ts');
	});

	test('собирает path из edits', () => {
		assert.strictEqual(
			pathFromToolArguments('{"edits":[{"path":"a.ts"},{"path":"b.ts"},{"path":"a.ts"}]}'),
			'a.ts, b.ts',
		);
	});

	test('битый JSON без path - undefined', () => {
		assert.strictEqual(pathFromToolArguments('{'), undefined);
		assert.strictEqual(pathFromToolArguments('{}'), undefined);
	});

	test('достаёт path из обрезанного write_file JSON', () => {
		const raw = '{"path": "news/handlers/news_handler.go", "content": "package handlers\\n\\nfunc (h *NewsHandler) GetAllNews';
		assert.strictEqual(pathFromToolArguments(raw), 'news/handlers/news_handler.go');
	});
});

suite('tool argument JSON', () => {
	test('sanitize делает валидный JSON из обрезанной строки', () => {
		const raw = '{"path":"a.go","content":"package x';
		const sanitized = sanitizeToolArgumentsForApi(raw);
		const parsed = JSON.parse(sanitized) as { error: string; path: string };
		assert.strictEqual(parsed.error, 'invalid_or_truncated_json');
		assert.strictEqual(parsed.path, 'a.go');
	});

	test('parse объясняет обрезку и не пишет файл', () => {
		assert.throws(
			() => parseToolArguments('{"path":"a.go","content":"package x'),
			(err: unknown) => err instanceof Error
				&& err.message.includes('невалидный JSON')
				&& err.message.includes('a.go')
				&& err.message.includes('не записан'),
		);
	});
});

suite('commandPolicy', () => {
	test('разрешает npm test', () => {
		assert.doesNotThrow(() => assertAllowedCommand('npm', ['test']));
	});

	test('запрещает npm install', () => {
		assert.throws(
			() => assertAllowedCommand('npm', ['install']),
			(err: unknown) => err instanceof CommandPolicyError,
		);
	});

	test('запрещает go run', () => {
		assert.throws(
			() => assertAllowedCommand('go', ['run', '.']),
			(err: unknown) => err instanceof CommandPolicyError,
		);
	});

	test('запрещает node -e', () => {
		assert.throws(
			() => assertAllowedCommand('node', ['-e', '1']),
			(err: unknown) => err instanceof CommandPolicyError,
		);
	});

	test('formatCommandLine экранирует пробелы', () => {
		assert.strictEqual(formatCommandLine('npm', ['run', 'my script']), 'npm run "my script"');
	});
});

suite('redactSecrets', () => {
	test('маскирует ключи и токены', () => {
		const raw = 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789 extra AKIAIOSFODNN7EXAMPLE';
		const { text, count } = redactSecrets(raw);
		assert.ok(count >= 1);
		assert.ok(!text.includes('ghp_'));
		assert.ok(!text.includes('AKIAIOSFODNN7EXAMPLE'));
		assert.ok(text.includes('[REDACTED]'));
	});
});
