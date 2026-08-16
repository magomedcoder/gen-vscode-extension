import * as assert from 'assert';
import * as path from 'node:path';
import { applySearchReplace, PatchError } from '../agent/patch';
import { assertAllowedPath, isDeniedRelativePath, pathIsInside, resolveAgainstFolders } from '../agent/policy';

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

	test('node_modules и .env запрещены', () => {
		assert.ok(isDeniedRelativePath('node_modules/pkg/index.js'));
		assert.ok(isDeniedRelativePath('.env'));
		assert.ok(isDeniedRelativePath('app/.env.local'));
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
