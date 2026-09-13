import * as assert from 'assert';
import { mergeAlwaysAllow } from '../core/stores/alwaysAllowStore.js';
import { DEFAULT_SETTINGS } from '../core/config/types.js';

suite('persist always allow', () => {
	test('DEFAULT_SETTINGS.persistAlwaysAllow === false', () => {
		assert.strictEqual(DEFAULT_SETTINGS.persistAlwaysAllow, false);
	});

	test('mergeAlwaysAllow без дублей', () => {
		const merged = mergeAlwaysAllow(['npm*', 'git*'], ['git*', 'curl*', 'npm*']);
		assert.deepStrictEqual(merged, ['npm*', 'git*', 'curl*']);
	});

	test('mergeAlwaysAllow пустой persisted', () => {
		assert.deepStrictEqual(mergeAlwaysAllow(['a'], []), ['a']);
	});
});
