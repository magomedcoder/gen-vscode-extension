import * as assert from 'node:assert';
import { registerBuiltins } from '../features/agent/tools/builtins.js';
import { getToolByName, getToolMeta } from '../features/agent/tools/registry.js';
import { annotateHtmlWithSourceHints, extractSelectorOuterHtml, selectorSearchTokens } from '../features/design/designVisual.js';

suite('find_references / design_inspect smoke', () => {
	suiteSetup(() => {
		registerBuiltins();
	});

	test('find_references registered', () => {
		const tool = getToolByName('find_references');
		assert.ok(tool);
		const meta = getToolMeta('find_references');
		assert.ok(meta?.tags.includes('ide'));
		assert.strictEqual(meta?.risk, 'read');
	});

	test('design_inspect registered', () => {
		const tool = getToolByName('design_inspect');
		assert.ok(tool);
		const meta = getToolMeta('design_inspect');
		assert.ok(meta?.tags.includes('meta'));
	});

	test('find_references missing position fails gracefully', async () => {
		const tool = getToolByName('find_references')!;
		try {
			const result = await tool.execute({ path: 'package.json' }, {});
			assert.strictEqual(result.ok, false);
			assert.ok(/line|symbol|workspace|path|policy/i.test(result.content), result.content);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			assert.ok(/workspace|path|policy/i.test(msg), msg);
		}
	});

	test('annotateHtmlWithSourceHints + selector extract', () => {
		const html = `<html><body><div id="root" class="app-shell">Hi</div></body></html>`;
		const annotated = annotateHtmlWithSourceHints(html, 'http://localhost:5173/');
		assert.ok(annotated.html.includes('data-gen-src') || annotated.html.includes('gen-design:'));
		const hit = extractSelectorOuterHtml(annotated.html, '#root');
		assert.strictEqual(hit.matched, true);
		assert.ok(hit.outerHtml?.includes('id="root"'));
		assert.deepStrictEqual(selectorSearchTokens('#root.app-shell'), ['root', 'app-shell']);
	});
});
