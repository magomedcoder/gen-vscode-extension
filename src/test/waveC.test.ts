import * as assert from 'assert';
import { buildImportGraph, extractJsImports, findImportCycles, findOrphanFiles } from '../features/agent/tools/meta/repoHealthCore.js';
import { isTestPath, pathsFromGitPorcelain, suggestRelatedTests } from '../features/agent/tools/meta/testImpactCore.js';
import { handleDesignClick } from '../features/design/designVisual.js';
import { clearToolsForTests, getToolByName, getToolSource, registerTool, unregisterEphemeralTools } from '../features/agent/tools/registry.js';
import { registerBuiltins } from '../features/agent/tools/builtins.js';
import type { ToolDefinition } from '../features/agent/types.js';

suite('Wave C helpers', () => {
	test('extractJsImports + cycle detection', () => {
		const imports = extractJsImports(`
			import { a } from './a';
			const b = require('./b');
			export * from '../c';
		`);
		assert.ok(imports.includes('./a'));
		assert.ok(imports.includes('./b'));
		assert.ok(imports.includes('../c'));

		const files = [
			{ 
				path: 'src/a.ts', 
				source: "import { b } from './b';\n" 
			},
			{ 
				path: 'src/b.ts', 
				source: "import { a } from './a';\n" 
			},
			{ 
				path: 'src/c.ts', 
				source: "export const c = 1;\n" 
			},
		];
		const graph = buildImportGraph(files);
		const cycles = findImportCycles(graph);
		assert.ok(cycles.some((c) => c.includes('src/a.ts') && c.includes('src/b.ts')));
		const orphans = findOrphanFiles(graph);
		assert.ok(orphans.includes('src/c.ts'));
	});

	test('test_impact heuristics', () => {
		assert.ok(isTestPath('src/foo.test.ts'));
		assert.ok(isTestPath('src/__tests__/foo.ts'));
		const related = suggestRelatedTests(
			['src/features/agent/auth.ts'],
			[
				'src/features/agent/auth.ts',
				'src/features/agent/auth.test.ts',
				'src/test/auth.test.ts',
				'src/other.ts',
			],
		);
		assert.ok(related.some((p) => p.includes('auth') && isTestPath(p)));
		assert.deepStrictEqual(
			pathsFromGitPorcelain(' M src/a.ts\n?? src/b.ts\nR  old.ts -> new.ts\n'),
			['src/a.ts', 'src/b.ts', 'new.ts'],
		);
	});

	test('design visual stub rejects click-to-code', () => {
		const r = handleDesignClick({ url: 'http://localhost:3000', selector: '#root' });
		assert.strictEqual(r.handled, false);
		assert.ok(/не реализован|not implemented/i.test(r.message));
	});

	test('ephemeral register / unregister', () => {
		clearToolsForTests();
		registerBuiltins();
		const tool: ToolDefinition = {
			name: 'tmp_hint',
			description: 'tmp',
			parameters: { type: 'object', properties: {} },
			async execute() {
				return { ok: true, content: 'body' };
			},
		};
		registerTool(tool, { 
			tags: ['meta'], 
			risk: 'read' 
		}, 'ephemeral');
		assert.strictEqual(getToolSource('tmp_hint'), 'ephemeral');
		unregisterEphemeralTools();
		assert.strictEqual(getToolByName('tmp_hint'), undefined);
		assert.ok(getToolByName('read_file'));
	});
});
