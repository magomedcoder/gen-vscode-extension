import * as assert from 'assert';
import { activityKindFromTool, summarizeToolActivity } from '../stores/activityStore.js';

suite('activity ledger', () => {
	test('классифицирует kind по имени tool', () => {
		assert.strictEqual(activityKindFromTool('run_command'), 'shell');
		assert.strictEqual(activityKindFromTool('await_shell'), 'shell');
		assert.strictEqual(activityKindFromTool('call_mcp_tool'), 'mcp');
		assert.strictEqual(activityKindFromTool('write_file'), 'edit');
		assert.strictEqual(activityKindFromTool('read_file'), 'tool');
	});

	test('summarize берёт path / command / mcp', () => {
		assert.strictEqual(
			summarizeToolActivity('write_file', '{}', 'src/a.ts'),
			'write_file: src/a.ts',
		);
		assert.strictEqual(
			summarizeToolActivity('run_command', JSON.stringify({ command: 'ls -la' })),
			'run_command: ls -la',
		);
		assert.strictEqual(
			summarizeToolActivity(
				'call_mcp_tool',
				JSON.stringify({ server: 'fs', toolName: 'list' }),
			),
			'call_mcp_tool: fs/list',
		);
	});
});
