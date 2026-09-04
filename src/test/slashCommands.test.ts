import * as assert from 'assert';
import { activeSlashQuery, filterSlashCommands, parseSlashMode } from '../chat/slashCommands.js';

suite('slashCommands', () => {
	test('parseSlashMode: режимы', () => {
		assert.deepStrictEqual(parseSlashMode('/debug'), {
			mode: 'debug', 
			command: 'debug', 
			rest: '' 
		});
		assert.deepStrictEqual(parseSlashMode('/plan'), {
			mode: 'plan', 
			command: 'plan', 
			rest: '' 
		});
		assert.deepStrictEqual(parseSlashMode('/export'), {
			mode: undefined, 
			command: 'export', 
			rest: '' 
		});
	});

	test('parseSlashMode: остаток после команды', () => {
		assert.deepStrictEqual(parseSlashMode('/debug почему падает?'), {
			mode: 'debug',
			command: 'debug',
			rest: 'почему падает?',
		});
	});

	test('parseSlashMode: не команда', () => {
		assert.strictEqual(parseSlashMode('debug'), undefined);
		assert.strictEqual(parseSlashMode('/foobar'), undefined);
	});

	test('activeSlashQuery только в начале', () => {
		assert.deepStrictEqual(activeSlashQuery('/de', 3), {
			start: 0,
			query: 'de'
		});
		assert.strictEqual(activeSlashQuery('/debug x', 8), undefined);
	});

	test('filterSlashCommands', () => {
		assert.ok(filterSlashCommands('').length >= 5);
		assert.deepStrictEqual(
			filterSlashCommands('de').map((c) => c.name),
			['debug', 'design'],
		);
	});
});
