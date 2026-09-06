import * as assert from 'assert';
import type { ToolDefinition } from '../features/agent/types.js';
import { registerBuiltins } from '../features/agent/tools/builtins.js';
import { refreshDynamicTools, sanitizeDynamicToolName } from '../features/agent/tools/dynamicTools.js';
import { clearToolsForTests, getToolByName, getToolSource, listTools, registerTool, unregisterDynamicTools } from '../features/agent/tools/registry.js';

function fakeTool(name: string): ToolDefinition {
	return {
		name,
		description: `test ${name}`,
		parameters: { type: 'object', properties: {} },
		async execute() {
			return { ok: true, content: name };
		},
	};
}

suite('dynamic tools', () => {
	setup(() => {
		clearToolsForTests();
	});

	teardown(() => {
		clearToolsForTests();
		registerBuiltins();
	});

	test('sanitizeDynamicToolName', () => {
		assert.strictEqual(sanitizeDynamicToolName('My Tool!'), 'my_tool');
		assert.strictEqual(sanitizeDynamicToolName('  Foo-Bar  '), 'foo-bar');
		assert.strictEqual(sanitizeDynamicToolName('@@@'), 'local_tool');
	});

	test('dynamic заменяет dynamic; builtin не трогает', async () => {
		registerTool(fakeTool('read_file'), { tags: ['fs'], risk: 'read' }, 'builtin');
		registerTool(fakeTool('demo'), { tags: ['meta'], risk: 'read' }, 'dynamic');
		assert.strictEqual(getToolSource('demo'), 'dynamic');

		registerTool(fakeTool('demo'), { tags: ['meta'], risk: 'read' }, 'dynamic');
		assert.throws(
			() => registerTool(fakeTool('read_file'), { tags: ['meta'], risk: 'read' }, 'dynamic'),
			/already registered/,
		);

		unregisterDynamicTools();
		assert.strictEqual(getToolByName('demo'), undefined);
		assert.ok(getToolByName('read_file'));
	});

	test('refreshDynamicTools без workspace - пусто и builtins целы', async () => {
		registerBuiltins();
		const before = listTools().length;
		const names = await refreshDynamicTools();
		assert.deepStrictEqual(names, []);
		assert.strictEqual(listTools().length, before);
	});
});
