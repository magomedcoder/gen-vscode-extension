import * as assert from 'assert';
import { FIND_CODE_MAX_CHARS, mergeFindCodeHits, truncateFindCodeJson } from '../features/agent/tools/search/findCodeMerge.js';
import type { FindCodeRawHit } from '../features/agent/tools/search/findCodeMerge.js';

suite('find_code merge/ranking', () => {
	test('дедуп по path+line и boost за несколько источников', () => {
		const raw: FindCodeRawHit[] = [
			{
				path: 'src/a.ts',
				line: 10,
				snippet: 'function foo()',
				score: 0.7,
				source: 'grep',
				why: 'текстовое совпадение',
			},
			{
				path: 'src/a.ts',
				line: 10,
				snippet: 'export function foo() {',
				score: 0.8,
				source: 'codebase_search',
				why: 'триграммный индекс',
			},
			{
				path: 'src/b.ts',
				snippet: 'bar',
				score: 0.9,
				source: 'file_search',
				why: 'совпадение по имени/пути',
			},
			{
				path: 'src/a.ts',
				line: 20,
				snippet: 'other',
				score: 0.5,
				source: 'grep',
				why: 'текстовое совпадение',
			},
		];

		const merged = mergeFindCodeHits(raw, 10);
		assert.strictEqual(merged.length, 3);

		const top = merged[0]!;
		assert.strictEqual(top.path, 'src/b.ts');
		assert.ok(top.score >= 0.9);

		const a10 = merged.find((h) => h.path === 'src/a.ts' && h.line === 10)!;
		assert.ok(a10);
		assert.deepStrictEqual(a10.sources.sort(), ['codebase_search', 'grep']);
		assert.ok(a10.score > 0.8, `expected boost, got ${a10.score}`);
		assert.ok((a10.snippet ?? '').includes('export function'));
		assert.ok(a10.why.includes('текстовое') && a10.why.includes('триграмм'));
	});

	test('dirty/recent/path boost поднимает score', () => {
		const raw: FindCodeRawHit[] = [
			{ 
				path: 'src/clean.ts', 
				score: 0.8, 
				source: 'grep', 
				why: 'text' 
			},
			{ 
				path: 'src/dirty.ts', 
				score: 0.75, 
				source: 'grep', 
				why: 'text' 
			},
			{ 
				path: 'src/recent.ts', 
				score: 0.76, 
				source: 'grep', 
				why: 'text' 
			},
		];
		const merged = mergeFindCodeHits(raw, 10, {
			dirtyPaths: ['src/dirty.ts'],
			recentPaths: ['src/recent.ts'],
			pathQuery: 'dirty',
		});
		assert.strictEqual(merged[0]!.path, 'src/dirty.ts');
		assert.ok(merged[0]!.score > 0.75);
		assert.ok(merged[0]!.why.includes('git dirty'));
		assert.ok(merged[0]!.why.includes('path match'));

		const recent = merged.find((h) => h.path === 'src/recent.ts')!;
		assert.ok(recent.why.includes('recent'));
		assert.ok(recent.score > 0.76);
	});

	test('max_results обрезает после сортировки', () => {
		const raw: FindCodeRawHit[] = [
			{ path: 'c.ts', 
				score: 0.3, 
				source: 'glob', 
				why: 'c' 
			},
			{ path: 'a.ts', 
				score: 0.9, 
				source: 'glob', 
				why: 'a' 
			},
			{ path: 'b.ts', 
				score: 0.6, 
				source: 'glob', 
				why: 'b' 
			},
		];
		const merged = mergeFindCodeHits(raw, 2);
		assert.strictEqual(merged.length, 2);
		assert.strictEqual(merged[0]!.path, 'a.ts');
		assert.strictEqual(merged[1]!.path, 'b.ts');
	});

	test('truncateFindCodeJson обрезает длинный payload', () => {
		const hits = Array.from({ length: 40 }, (_, i) => ({
			path: `src/long/path/file_${i}.ts`,
			snippet: 'x'.repeat(200),
			score: 1 - i * 0.01,
			sources: ['grep', 'codebase_search'],
			why: 'длинный why '.repeat(5),
		}));
		const json = truncateFindCodeJson({
			query: 'test',
			intent: 'mixed',
			hits,
			notes: [],
		}, 2_000);
		assert.ok(json.length <= 2_000);
		const parsed = JSON.parse(json) as { truncated?: boolean; hits: unknown[] };
		assert.strictEqual(parsed.truncated, true);
		assert.ok(parsed.hits.length < hits.length);
	});

	test('FIND_CODE_MAX_CHARS константа разумна', () => {
		assert.ok(FIND_CODE_MAX_CHARS >= 4_000);
	});
});
