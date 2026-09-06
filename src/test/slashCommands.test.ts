import * as assert from 'assert';
import { activeSlashQuery, filterSlashCommands, parseSlashMode } from '../chat/slashCommands.js';
import { expandCommandTemplate } from '../project/customCommands.js';
import { parseBangCommands, splitCommandLine } from '../chat/bangCommand.js';
import { splitIntoTurns } from '../chat/compact.js';

suite('slashCommands', () => {
	test('parseSlashMode: режимы', () => {
		assert.deepStrictEqual(parseSlashMode('/debug'), {
			mode: 'debug',
			command: 'debug',
			rest: '',
			custom: false,
		});
		assert.deepStrictEqual(parseSlashMode('/plan'), {
			mode: 'plan',
			command: 'plan',
			rest: '',
			custom: false,
		});
		assert.deepStrictEqual(parseSlashMode('/export'), {
			mode: undefined,
			command: 'export',
			rest: '',
			custom: false,
		});
		assert.deepStrictEqual(parseSlashMode('/import'), {
			mode: undefined,
			command: 'import',
			rest: '',
			custom: false,
		});
		assert.deepStrictEqual(parseSlashMode('/new'), {
			mode: undefined,
			command: 'new',
			rest: '',
			custom: false,
		});
		assert.deepStrictEqual(parseSlashMode('/redo'), {
			mode: undefined,
			command: 'redo',
			rest: '',
			custom: false,
		});
	});

	test('parseSlashMode: остаток после команды', () => {
		assert.deepStrictEqual(parseSlashMode('/debug почему падает?'), {
			mode: 'debug',
			command: 'debug',
			rest: 'почему падает?',
			custom: false,
		});
	});

	test('parseSlashMode: кастомные', () => {
		const extra = [{ id: 'custom:review', name: 'review', detail: 'Code review' }];
		assert.deepStrictEqual(parseSlashMode('/review foo', extra), {
			mode: undefined,
			command: 'review',
			rest: 'foo',
			custom: true,
		});
	});

	test('parseSlashMode: не команда', () => {
		assert.strictEqual(parseSlashMode('debug'), undefined);
		assert.strictEqual(parseSlashMode('/foobar'), undefined);
	});

	test('activeSlashQuery только в начале', () => {
		assert.deepStrictEqual(activeSlashQuery('/de', 3), {
			start: 0,
			query: 'de',
		});
		assert.strictEqual(activeSlashQuery('/debug x', 8), undefined);
	});

	test('filterSlashCommands', () => {
		assert.ok(filterSlashCommands('').length >= 10);
		assert.deepStrictEqual(
			filterSlashCommands('de').map((c) => c.name),
			['debug', 'design'],
		);
		assert.ok(filterSlashCommands('rev', [{ id: 'c', name: 'review', detail: 'x' }]).some((c) => c.name === 'review'));
	});

	test('expandCommandTemplate', () => {
		assert.strictEqual(
			expandCommandTemplate('Review $ARGUMENTS\nFile: $1', 'src/a.ts --strict'),
			'Review src/a.ts --strict\nFile: src/a.ts',
		);
	});

	test('parseBangCommands', () => {
		const bangs = parseBangCommands('look `!git status` and !ls -la');
		assert.ok(bangs.length >= 1);
		assert.ok(bangs.some((b) => b.commandLine.includes('git status')));
	});

	test('splitCommandLine', () => {
		assert.deepStrictEqual(splitCommandLine('git status'), {
			command: 'git',
			args: ['status'],
		});
	});

	test('splitIntoTurns', () => {
		const turns = splitIntoTurns([
			{ id: '1', role: 'user', content: 'a' },
			{ id: '2', role: 'assistant', content: 'b' },
			{ id: '3', role: 'user', content: 'c' },
		]);
		assert.strictEqual(turns.length, 2);
	});
});
