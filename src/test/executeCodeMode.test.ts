import * as assert from 'assert';
import { CODE_MODE_MAX_STEPS, parseCodeModeSteps, parseMcpToolRef } from '../features/agent/tools/mcp/execute.js';
import { toolActionType } from '../features/agent/permissionPolicy.js';
import { activityKindFromTool, summarizeToolActivity } from '../core/stores/activityStore.js';

suite('execute / code-mode', () => {
	test('parseMcpToolRef: server__tool', () => {
		assert.deepStrictEqual(parseMcpToolRef('fs__list_dir'), { server: 'fs', toolName: 'list_dir' });
		assert.deepStrictEqual(parseMcpToolRef('demo__read_file'), { server: 'demo', toolName: 'read_file' });
		assert.strictEqual(parseMcpToolRef('no_sep'), undefined);
		assert.strictEqual(parseMcpToolRef('__tool'), undefined);
		assert.strictEqual(parseMcpToolRef('server__'), undefined);
	});

	test('parseCodeModeSteps: steps и script', () => {
		const fromSteps = parseCodeModeSteps({
			steps: [{ tool: 'fs__list', arguments: { path: '.' } }],
		});
		assert.ok(!('error' in fromSteps));
		assert.strictEqual(fromSteps.length, 1);
		assert.strictEqual(fromSteps[0]!.tool, 'fs__list');

		const fromScript = parseCodeModeSteps({
			script: JSON.stringify([{ tool: 'a__b' }, { tool: 'c__d', arguments: {} }]),
		});
		assert.ok(!('error' in fromScript));
		assert.strictEqual(fromScript.length, 2);

		assert.ok('error' in parseCodeModeSteps({ script: 'await mcp.call()' }));
		assert.ok('error' in parseCodeModeSteps({ steps: [{ tool: 'bad' }] }));
		assert.ok('error' in parseCodeModeSteps({
			steps: Array.from({ length: CODE_MODE_MAX_STEPS + 1 }, () => ({ tool: 's__t' })),
		}));
	});

	test('permission + activity: execute * mcp', () => {
		assert.strictEqual(toolActionType('execute'), 'mcp');
		assert.strictEqual(activityKindFromTool('execute'), 'mcp');
		assert.strictEqual(
			summarizeToolActivity(
				'execute',
				JSON.stringify({ steps: [{ tool: 'fs__list' }, { tool: 'fs__read' }] }),
			),
			'execute: fs__list (+1)',
		);
	});
});
