import * as assert from 'node:assert';
import { parseTsOutline, parseRegexOutlineFallback, isJsLikeOutlinePath, scoreOutlineQuery, searchOutlineEntries, summarizeOutlineForPath } from '../features/index/tsOutlineParse.js';

suite('tsOutlineParse', () => {
	test('isJsLikeOutlinePath', () => {
		assert.strictEqual(isJsLikeOutlinePath('src/a.ts'), true);
		assert.strictEqual(isJsLikeOutlinePath('x.tsx'), true);
		assert.strictEqual(isJsLikeOutlinePath('a.py'), false);
	});

	test('extracts imports, class, function from TS', () => {
		const src = `
import { foo } from './foo';
import Bar from './bar';

export class Widget {
  render() {
    return 1;
  }
}

export function helper(x: number) {
  return x;
}

export const arrow = () => 42;
`;
		const entries = parseTsOutline('src/widget.ts', src);
		const kinds = entries.map((e) => `${e.kind}:${e.name}`);
		assert.ok(kinds.includes('import:foo'), kinds.join(','));
		assert.ok(kinds.includes('import:Bar'), kinds.join(','));
		assert.ok(kinds.includes('class:Widget'), kinds.join(','));
		assert.ok(kinds.includes('method:render'), kinds.join(','));
		assert.ok(kinds.includes('function:helper'), kinds.join(','));
		assert.ok(kinds.includes('function:arrow'), kinds.join(','));
		const widget = entries.find((e) => e.name === 'Widget');
		assert.ok(widget);
		assert.ok(widget!.startLine >= 1);
	});

	test('regex fallback for python-ish', () => {
		const src = 'def hello():\n  pass\nclass Foo:\n  pass\n';
		const entries = parseRegexOutlineFallback('a.py', src);
		assert.ok(entries.some((e) => e.name === 'hello' && e.kind === 'function'));
		assert.ok(entries.some((e) => e.name === 'Foo' && e.kind === 'class'));
	});

	test('searchOutlineEntries ranks exact match first', () => {
		const entries = [
			{ 
				name: 'Widget', 
				kind: 'class' as const, 
				path: 'a.ts', 
				startLine: 1, 
				endLine: 2 
			},
			{ 
				name: 'WidgetHelper', 
				kind: 'function' as const, 
				path: 'b.ts', 
				startLine: 1, 
				endLine: 2 
			},
		];
		const hits = searchOutlineEntries('Widget', entries, 5);
		assert.strictEqual(hits[0]?.name, 'Widget');
		assert.ok(scoreOutlineQuery('Widget', hits[0]!) >= scoreOutlineQuery('Widget', hits[1]!));
	});

	test('summarizeOutlineForPath lists exports', () => {
		const src = `
export class Widget {}
export function helper() {}
import { x } from './x';
`;
		const entries = parseTsOutline('src/widget.ts', src);
		const summary = summarizeOutlineForPath(entries, 'src/widget.ts');
		assert.ok(summary?.includes('Widget'), summary);
		assert.ok(summary?.includes('helper'), summary);
		assert.ok(!summary?.includes('import'), summary);
	});
});
