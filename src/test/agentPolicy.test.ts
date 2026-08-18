import * as assert from 'assert';
import * as path from 'node:path';
import { applySearchReplace, PatchError } from '../agent/patch';
import { assertAllowedPath, isDeniedRelativePath, pathIsInside, resolveAgainstFolders } from '../agent/policy';
import { parseWorkspaceEdits } from '../agent/tools/applyWorkspaceEdit';
import { assertAllowedCommand, CommandPolicyError, formatCommandLine } from '../agent/commandPolicy';
import { formatMiniDiff, pathFromToolArguments } from '../agent/diff';
import { formatPlan, mutationPathsFromArgs, parsePlanArgs, TurnPlan } from '../agent/plan';
import { redactSecrets } from '../agent/secrets';
import { parseToolArguments, sanitizeToolArgumentsForApi } from '../agent/types';
import { EXAMPLE_DENIED_PATHS, EXAMPLE_SECRET_PATTERNS } from '../config/types';

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

	test('пустой список ничего не запрещает', () => {
		assert.ok(!isDeniedRelativePath('node_modules/pkg/index.js', []));
		assert.ok(!isDeniedRelativePath('.env', []));
		assert.ok(!isDeniedRelativePath('certs/server.pem', []));
	});

	test('шаблоны из настроек запрещают .env, ключи и node_modules', () => {
		assert.ok(isDeniedRelativePath('node_modules/pkg/index.js', EXAMPLE_DENIED_PATHS));
		assert.ok(isDeniedRelativePath('.env', EXAMPLE_DENIED_PATHS));
		assert.ok(isDeniedRelativePath('app/.env.local', EXAMPLE_DENIED_PATHS));
		assert.ok(isDeniedRelativePath('certs/server.pem', EXAMPLE_DENIED_PATHS));
		assert.ok(isDeniedRelativePath('.git/config', EXAMPLE_DENIED_PATHS));
		assert.ok(!isDeniedRelativePath('src/index.ts', EXAMPLE_DENIED_PATHS));
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

	test('собирает path из steps плана', () => {
		assert.strictEqual(pathFromToolArguments('{"title":"x","steps":[{"path":"a.go"},{"path":"b.go"}]}'), 'a.go, b.go');
	});

	test('собирает path из edits', () => {
		assert.strictEqual(pathFromToolArguments('{"edits":[{"path":"a.ts"},{"path":"b.ts"},{"path":"a.ts"}]}'), 'a.ts, b.ts');
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
	test('разрешает npm test, go test, python, go run', () => {
		assert.doesNotThrow(() => assertAllowedCommand('npm', ['test']));
		assert.doesNotThrow(() => assertAllowedCommand('go', ['test', './...']));
		assert.doesNotThrow(() => assertAllowedCommand('python', ['app.py']));
		assert.doesNotThrow(() => assertAllowedCommand('go', ['run', '.']));
	});

	test('запрещает npm install', () => {
		assert.throws(
			() => assertAllowedCommand('npm', ['install']),
			(err: unknown) => err instanceof CommandPolicyError,
		);
	});

	test('запрещает node -e, python -c, curl, rm, git push', () => {
		assert.throws(() => assertAllowedCommand('node', ['-e', '1']), (err: unknown) => err instanceof CommandPolicyError);
		assert.throws(() => assertAllowedCommand('python', ['-c', '1']), (err: unknown) => err instanceof CommandPolicyError);
		assert.throws(() => assertAllowedCommand('curl', ['https://example.com']), (err: unknown) => err instanceof CommandPolicyError);
		assert.throws(() => assertAllowedCommand('rm', ['-rf', 'src']), (err: unknown) => err instanceof CommandPolicyError);
		assert.throws(() => assertAllowedCommand('git', ['-C', '/tmp', 'push']), (err: unknown) => err instanceof CommandPolicyError);
	});

	test('gcc -c файл можно, python -c код нельзя', () => {
		assert.doesNotThrow(() => assertAllowedCommand('gcc', ['-c', 'foo.c']));
		assert.doesNotThrow(() => assertAllowedCommand('tar', ['-c', '-f', 'out.tar', 'src']));
		assert.doesNotThrow(() => assertAllowedCommand('git', ['-c', 'user.name=gen', 'status']));
		assert.throws(() => assertAllowedCommand('python', ['-c', 'print(1)']), (err: unknown) => err instanceof CommandPolicyError);
		assert.throws(() => assertAllowedCommand('ruby', ['-c', 'p 1']), (err: unknown) => err instanceof CommandPolicyError);
	});

	test('formatCommandLine экранирует пробелы', () => {
		assert.strictEqual(formatCommandLine('npm', ['run', 'my script']), 'npm run "my script"');
	});
});

suite('TurnPlan', () => {
	test('один файл без плана разрешён', () => {
		const plan = new TurnPlan();
		assert.strictEqual(plan.guard(['src/a.ts']), undefined);
		assert.strictEqual(plan.guard(['src/a.ts']), undefined);
	});

	test('второй файл без плана запрещён', () => {
		const plan = new TurnPlan();
		assert.ok(!plan.guard(['a.ts']));
		const denied = plan.guard(['b.ts']);
		assert.ok(denied?.denied);
		assert.ok(denied?.content.includes('propose_plan'));
	});

	test('apply_workspace_edit на два файла требует план', () => {
		const plan = new TurnPlan();
		const paths = mutationPathsFromArgs('apply_workspace_edit', {
			edits: [{ path: 'a.ts' }, { path: 'b.ts' }],
		});
		assert.deepStrictEqual(paths, ['a.ts', 'b.ts']);
		assert.ok(plan.guard(paths)?.denied);
	});

	test('после approve несколько файлов можно', () => {
		const plan = new TurnPlan();
		plan.approve();
		assert.ok(!plan.guard(['a.ts', 'b.ts']));
	});
});

suite('parsePlanArgs', () => {
	test('форматирует шаги', () => {
		const parsed = parsePlanArgs({
			title: 'Фича',
			steps: [
				{ title: 'handler', path: 'news/handlers/news_handler.go', action: 'write' },
				{ summary: 'тесты', path: 'news/handlers/news_handler_test.go' },
			],
		});
		assert.strictEqual(parsed.steps.length, 2);
		const text = formatPlan(parsed);
		assert.ok(text.includes('Фича'));
		assert.ok(text.includes('news/handlers/news_handler.go'));
	});

	test('пустые steps - ошибка', () => {
		assert.throws(() => parsePlanArgs({ title: 'x', steps: [] }));
	});
});

suite('redactSecrets', () => {
	test('без шаблонов ничего не маскирует', () => {
		const raw = 'token: supersecretvalue extra';
		const { text, count } = redactSecrets(raw, []);
		assert.strictEqual(count, 0);
		assert.strictEqual(text, raw);
	});

	test('маскирует ключи по шаблонам из настроек', () => {
		const raw = 'token: supersecretvalue extra eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signaturexx';
		const { text, count } = redactSecrets(raw, EXAMPLE_SECRET_PATTERNS);
		assert.ok(count >= 1);
		assert.ok(!text.includes('supersecretvalue'));
		assert.ok(text.includes('[REDACTED]'));
	});
});
