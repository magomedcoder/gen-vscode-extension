import * as assert from 'assert';
import { buildTreeFromPaths, extractCommentSummary, formatOutline, heuristicFileSummary, isProjectMapStale } from '../features/index/projectMap.js';
import type { ProjectMapDocument } from '../features/index/projectMap.js';

suite('projectMap heuristics', () => {
	test('heuristicFileSummary: basename + extension', () => {
		const s = heuristicFileSummary('src/features/index/projectMap.ts');
		assert.ok(s.includes('projectMap.ts'));
		assert.ok(s.includes('TypeScript'));
	});

	test('extractCommentSummary: // и #', () => {
		assert.strictEqual(extractCommentSummary('// hello map\nexport const x = 1;\n'), 'hello map');
		assert.strictEqual(extractCommentSummary('# coding: utf-8\nprint(1)\n'), 'coding: utf-8');
		assert.strictEqual(extractCommentSummary('export const x = 1;\n// later\n'), undefined);
	});
});

suite('projectMap tree', () => {
	test('buildTreeFromPaths строит вложенность', () => {
		const summaries = new Map<string, string>([
			['src/a.ts', 'a.ts - TypeScript'],
			['src/b/c.ts', 'c.ts - TypeScript'],
			['package.json', 'package.json - JSON'],
		]);
		const { tree, fileCount, truncated } = buildTreeFromPaths(
			['src/a.ts', 'src/b/c.ts', 'package.json'],
			{ maxDepth: 8, summaries },
		);
		assert.strictEqual(fileCount, 3);
		assert.strictEqual(truncated, false);
		assert.ok(tree.some((n) => n.name === 'package.json' && n.type === 'file'));
		const src = tree.find((n) => n.name === 'src' && n.type === 'dir');
		assert.ok(src?.children);
		assert.ok(src!.children!.some((n) => n.name === 'a.ts'));
		const b = src!.children!.find((n) => n.name === 'b');
		assert.ok(b?.children?.some((n) => n.name === 'c.ts'));
	});

	test('maxDepth обрезает глубокие пути', () => {
		const { truncated, tree } = buildTreeFromPaths(['a/b/c/d/e.ts'], { maxDepth: 2 });
		assert.strictEqual(truncated, true);
		const a = tree.find((n) => n.name === 'a');
		assert.ok(a);
	});

	test('formatOutline читаемый текст', () => {
		const { tree } = buildTreeFromPaths(['src/x.ts'], {
			maxDepth: 4,
			summaries: new Map([['src/x.ts', 'x.ts - TypeScript']]),
		});
		const outline = formatOutline(tree);
		assert.ok(outline.includes('src/'));
		assert.ok(outline.includes('x.ts'));
	});

	test('isProjectMapStale: нет кэша / старше индекса', () => {
		assert.strictEqual(isProjectMapStale(undefined, '2026-01-01T00:00:00.000Z'), true);
		const cached: ProjectMapDocument = {
			updatedAt: '2026-01-01T00:00:00.000Z',
			source: 'index',
			fileCount: 1,
			maxDepth: 8,
			truncated: false,
			tree: [],
		};
		assert.strictEqual(isProjectMapStale(cached, undefined), false);
		assert.strictEqual(isProjectMapStale(cached, '2026-01-01T00:00:00.000Z'), false);
		assert.strictEqual(isProjectMapStale(cached, '2026-06-01T00:00:00.000Z'), true);
		assert.strictEqual(isProjectMapStale(cached, undefined, '2026-06-01T00:00:00.000Z'), true);
	});
});
