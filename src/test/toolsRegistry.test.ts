import * as assert from 'assert';
import type { ToolDefinition } from '../features/agent/types.js';
import { registerBuiltins } from '../features/agent/tools/builtins.js';
import { clearToolsForTests, getToolByName, getToolMeta, listTools, listToolsByTag, registerTool } from '../features/agent/tools/registry.js';

function fakeTool(name: string): ToolDefinition {
	return {
		name,
		description: `test ${name}`,
		parameters: { 
			type: 'object',
			properties: {}
		},
		async execute() {
			return {
				ok: true,
				content: name
			};
		},
	};
}

suite('tools registry', () => {
	setup(() => {
		clearToolsForTests();
	});

	teardown(() => {
		clearToolsForTests();
		// Восстановить builtin после изоляции suite
		registerBuiltins();
	});

	test('registerTool / getToolByName / listTools', () => {
		const a = fakeTool('alpha');
		const b = fakeTool('beta');
		registerTool(a);
		registerTool(b);
		assert.strictEqual(getToolByName('alpha'), a);
		assert.strictEqual(getToolByName('missing'), undefined);
		assert.deepStrictEqual(listTools().map((t) => t.name), ['alpha', 'beta']);
	});

	test('повтор того же объекта - no-op', () => {
		const a = fakeTool('same');
		registerTool(a);
		registerTool(a);
		assert.strictEqual(listTools().length, 1);
	});

	test('дубликат имени с другим объектом - throw', () => {
		registerTool(fakeTool('dup'));
		assert.throws(() => registerTool(fakeTool('dup')), /already registered: dup/);
	});

	test('filter listTools как getAgentLlmTools', () => {
		registerTool(fakeTool('read_file'));
		registerTool(fakeTool('write_file'));
		registerTool(fakeTool('run_command'));
		const names = listTools()
			.filter((t) => t.name !== 'run_command')
			.map((t) => t.name);
		assert.deepStrictEqual(names, ['read_file', 'write_file']);
	});

	test('meta: tags / risk / listToolsByTag', () => {
		registerTool(fakeTool('read_file'), { tags: ['fs'], risk: 'read' });
		registerTool(fakeTool('run_command'), { tags: ['shell'], risk: 'shell' });
		registerTool(fakeTool('web_search'), { tags: ['meta'], risk: 'web' });
		assert.deepStrictEqual(getToolMeta('read_file'), { tags: ['fs'], risk: 'read' });
		assert.deepStrictEqual(listToolsByTag('shell').map((t) => t.name), ['run_command']);
		assert.strictEqual(getToolMeta('missing'), undefined);
	});

	test('builtins имеют meta', () => {
		registerBuiltins();
		assert.ok(listTools().length > 40);
		assert.deepStrictEqual(getToolMeta('write_file')?.tags, ['fs']);
		assert.strictEqual(getToolMeta('write_file')?.risk, 'write');
		assert.ok(listToolsByTag('mcp').some((t) => t.name === 'call_mcp_tool'));
	});
});
