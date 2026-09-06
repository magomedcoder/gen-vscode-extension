import * as assert from 'node:assert';
import { mergeGenHooksLists, parseSettingsJsonHooks, parseHooksJsonFile, listExternalHookCandidates } from '../project/externalHooks.js';

suite('externalHooks', () => {
	test('listExternalHookCandidates: user + project пути', () => {
		const list = listExternalHookCandidates('/ws', '/home/u');
		assert.deepStrictEqual(
			list.map((c) => c.kind),
			['hooks-json-user', 'settings-json-user', 'hooks-json-project', 'settings-json-project'],
		);
		assert.ok(list[0].path.endsWith('.cursor/hooks.json'));
		assert.ok(list[1].path.endsWith('.claude/settings.json'));
		assert.strictEqual(list[2].path, '/ws/.cursor/hooks.json');
		assert.strictEqual(list[3].path, '/ws/.claude/settings.json');
	});

	test('listExternalHookCandidates: без workspace - только user', () => {
		const list = listExternalHookCandidates(undefined, '/home/u');
		assert.deepStrictEqual(
			list.map((c) => c.kind),
			['hooks-json-user', 'settings-json-user'],
		);
	});

	test('parseHooksJsonFile: маппинг известных событий + skipped', () => {
		const result = parseHooksJsonFile({
			version: 1,
			hooks: {
				beforeSubmitPrompt: [{ command: 'echo submit' }],
				beforeShellExecution: ['echo shell'],
				afterFileEdit: [{ command: 'echo diff' }],
				preCompact: [{ command: 'echo compact' }],
				unknownEvent: [{ command: 'echo skip' }],
			},
		});
		assert.deepStrictEqual(result.mapped.beforeSubmit, ['echo submit']);
		assert.deepStrictEqual(result.mapped.beforeShell, ['echo shell']);
		assert.deepStrictEqual(result.mapped.sessionDiff, ['echo diff']);
		assert.deepStrictEqual(result.mapped.sessionCompacting, ['echo compact']);
		assert.deepStrictEqual(result.skippedEvents, ['unknownEvent']);
		assert.strictEqual(result.mappedCommandCount, 4);
	});

	test('parseSettingsJsonHooks: UserPromptSubmit / PreToolUse Bash / PreCompact', () => {
		const result = parseSettingsJsonHooks({
			hooks: {
				UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo submit' }] }],
				PreToolUse: [
					{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo bash' }] },
					{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo read' }] },
				],
				PreCompact: [{ hooks: [{ type: 'command', command: 'echo compact' }] }],
			},
		});
		assert.deepStrictEqual(result.mapped.beforeSubmit, ['echo submit']);
		assert.deepStrictEqual(result.mapped.beforeShell, ['echo bash']);
		assert.deepStrictEqual(result.mapped.sessionCompacting, ['echo compact']);
		assert.ok(result.skippedEvents.some((e) => e.includes('PreToolUse')));
	});

	test('parseSettingsJsonHooks: prompt-handlers пропускаются', () => {
		const result = parseSettingsJsonHooks({
			hooks: {
				UserPromptSubmit: [{ hooks: [{ type: 'prompt', command: 'should skip' }] }],
			},
		});
		assert.deepStrictEqual(result.mapped.beforeSubmit, []);
		assert.strictEqual(result.mappedCommandCount, 0);
	});

	test('mergeGenHooksLists: append + dedupe', () => {
		const merged = mergeGenHooksLists(
			{
				beforeSubmit: ['a'],
				beforeShell: [],
				sessionDiff: [],
				sessionCompacting: [],
				shellEnv: [],
				fileWatcher: [],
			},
			{
				beforeSubmit: ['a', 'b'],
				beforeShell: ['c'],
				sessionDiff: [],
				sessionCompacting: [],
				shellEnv: [],
				fileWatcher: [],
			},
		);
		assert.deepStrictEqual(merged.beforeSubmit, ['a', 'b']);
		assert.deepStrictEqual(merged.beforeShell, ['c']);
	});
});
