import * as assert from 'assert';
import { registerBuiltins } from '../features/agent/tools/builtins.js';
import { getToolByName, getToolMeta, listToolsByTag, type ToolTag } from '../features/agent/tools/registry.js';
import type { ToolContext } from '../features/agent/types.js';
import type { ChatMode } from '../core/config/types.js';

suite('tools category smoke', () => {
	suiteSetup(() => {
		registerBuiltins();
	});

	function assertTagged(name: string, tag: ToolTag, risk?: string): void {
		const tool = getToolByName(name);
		assert.ok(tool, `missing tool ${name}`);
		const meta = getToolMeta(name);
		assert.ok(meta?.tags.includes(tag), `${name} tags=${JSON.stringify(meta?.tags)}`);
		if (risk) {
			assert.strictEqual(meta?.risk, risk, `${name} risk`);
		}
		assert.ok(listToolsByTag(tag).some((t) => t.name === name));
	}

	test('каждая категория зарегистрирована', () => {
		const expected: Array<[ToolTag, string]> = [
			['fs', 'read_file'],
			['search', 'glob'],
			['shell', 'run_command'],
			['ide', 'get_active_editor'],
			['mcp', 'list_mcp_tools'],
			['plan', 'plan_enter'],
			['meta', 'get_workspace_info'],
		];
		for (const [tag, name] of expected) {
			assertTagged(name, tag);
		}
	});

	test('fs: list_dir (workspace или policy)', async () => {
		assertTagged('list_dir', 'fs', 'read');
		assertTagged('write_file', 'fs', 'write');
		assertTagged('edit_file', 'fs', 'write');
		assertTagged('run_scratch', 'shell', 'shell');
		assertTagged('run_plugin', 'meta', 'shell');
		assertTagged('register_ephemeral_tool', 'meta', 'read');
		assertTagged('repo_health', 'meta', 'read');
		assertTagged('test_impact', 'meta', 'read');
		const tool = getToolByName('list_dir')!;
		try {
			const result = await tool.execute({ path: '.', max_entries: 5 }, {});
			assert.strictEqual(result.ok, true, result.content);
			assert.ok(result.content.length > 0);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			assert.ok(/noWorkspace|policy|workspace/i.test(msg), msg);
		}
	});

	test('search: glob', async () => {
		assertTagged('glob', 'search', 'read');
		const tool = getToolByName('glob')!;
		const result = await tool.execute({ pattern: 'package.json', max_results: 5 }, {});
		assert.strictEqual(result.ok, true, result.content);
	});

	test('shell: await_shell без сессии', async () => {
		assertTagged('await_shell', 'shell', 'shell');
		const tool = getToolByName('await_shell')!;
		const result = await tool.execute({ job_id: 'missing' }, {});
		assert.strictEqual(result.ok, false);
		assert.ok(result.content.toLowerCase().includes('shell'));
	});

	test('ide: get_active_editor', async () => {
		assertTagged('get_active_editor', 'ide', 'read');
		const tool = getToolByName('get_active_editor')!;
		const result = await tool.execute({}, {});
		assert.strictEqual(result.ok, true, result.content);
		assert.ok(result.content.includes('editor'));
	});

	test('mcp: list_mcp_tools', async () => {
		assertTagged('list_mcp_tools', 'mcp', 'mcp');
		const tool = getToolByName('list_mcp_tools')!;
		const result = await tool.execute({}, {});
		assert.strictEqual(result.ok, true, result.content);
		assert.ok(result.content.includes('tools'));
	});

	test('plan: plan_enter с mock setChatMode', async () => {
		assertTagged('plan_enter', 'plan', 'read');
		const tool = getToolByName('plan_enter')!;
		let mode: ChatMode | undefined;
		const ctx: ToolContext & { setChatMode: (m: ChatMode) => void } = {
			setChatMode(m) {
				mode = m;
			},
		};
		const result = await tool.execute({}, ctx);
		assert.strictEqual(result.ok, true, result.content);
		assert.strictEqual(mode, 'plan');
		assert.ok(result.content.includes('Plan') || result.content.includes('план') || result.content.length > 0);
	});

	test('meta: get_workspace_info + todo_read без store', async () => {
		assertTagged('get_workspace_info', 'meta', 'read');
		assertTagged('todo_read', 'meta', 'read');

		const info = await getToolByName('get_workspace_info')!.execute({}, {});
		assert.strictEqual(info.ok, true, info.content);
		assert.ok(info.content.includes('folderCount') || info.content.includes('folders'));

		const todos = await getToolByName('todo_read')!.execute({}, {});
		assert.strictEqual(todos.ok, false);
		assert.ok(todos.content.toLowerCase().includes('todo'));
	});
});
