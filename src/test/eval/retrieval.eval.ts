import * as assert from 'assert';
import { FIND_CODE_MAX_CHARS, mergeFindCodeHits, truncateFindCodeJson } from '../../features/agent/tools/search/findCodeMerge.js';
import type { FindCodeRawHit } from '../../features/agent/tools/search/findCodeMerge.js';
import { buildTreeFromPaths, formatOutline, heuristicFileSummary, isProjectMapStale } from '../../features/index/projectMap.js';
import type { ProjectMapDocument } from '../../features/index/projectMap.js';

suite('eval/retrieval', () => {
	test('fixture: symbol-like hits merge path+line и boost multi-source', () => {
		const raw: FindCodeRawHit[] = [
			{
				path: 'src/features/agent/AgentSession.ts',
				line: 218,
				snippet: 'export class AgentSession',
				score: 0.75,
				source: 'grep',
				why: 'symbol text',
			},
			{
				path: 'src/features/agent/AgentSession.ts',
				line: 218,
				snippet: 'export class AgentSession {',
				score: 0.82,
				source: 'codebase_search',
				why: 'trigram',
			},
			{
				path: 'src/features/chat/ChatSession.ts',
				line: 90,
				snippet: 'private readonly agent: AgentSession',
				score: 0.55,
				source: 'grep',
				why: 'reference',
			},
		];
		const merged = mergeFindCodeHits(raw, 5);
		assert.strictEqual(merged.length, 2);
		const top = merged.find((h) => h.path.includes('AgentSession.ts') && h.line === 218)!;
		assert.ok(top);
		assert.ok(top.sources.includes('grep') && top.sources.includes('codebase_search'));
		assert.ok(top.score > 0.82);
	});

	test('fixture: path intent предпочитает file_search score', () => {
		const raw: FindCodeRawHit[] = [
			{ 
				path: 'src/a/foo.ts', 
				score: 0.4, 
				source: 'grep', 
				why: 'text' 
			},
			{ 
				path: 'src/a/fooBar.ts', 
				score: 0.95, 
				source: 'file_search', 
				why: 'path' 
			},
			{ 
				path: 'src/b/other.ts', 
				score: 0.7, 
				source: 'glob', 
				why: 'glob' 
			},
		];
		const merged = mergeFindCodeHits(raw, 3);
		assert.strictEqual(merged[0]!.path, 'src/a/fooBar.ts');
		assert.strictEqual(merged[0]!.sources[0], 'file_search');
	});

	test('fixture: truncateFindCodeJson сохраняет query при обрезке', () => {
		const hits = Array.from({ length: 30 }, (_, i) => ({
			path: `pkg/module_${i}/index.ts`,
			snippet: 'y'.repeat(180),
			score: 1 - i * 0.02,
			sources: ['grep'],
			why: 'fixture',
		}));
		const json = truncateFindCodeJson({ 
			query: 'localize bug', 
			hits 
		}, FIND_CODE_MAX_CHARS);
		assert.ok(json.length <= FIND_CODE_MAX_CHARS);
		const parsed = JSON.parse(json) as { 
			query?: string; 
			truncated?: boolean 
		};
		assert.strictEqual(parsed.query, 'localize bug');
	});

	test('fixture: project map outline содержит модуль и summary', () => {
		const summaries = new Map<string, string>([
			['src/features/index/projectMap.ts', heuristicFileSummary('src/features/index/projectMap.ts')],
			['src/features/agent/tools/search/findCode.ts', heuristicFileSummary('src/features/agent/tools/search/findCode.ts')],
		]);
		const { tree, fileCount } = buildTreeFromPaths([...summaries.keys()], {
			maxDepth: 8,
			summaries,
		});
		assert.strictEqual(fileCount, 2);
		const outline = formatOutline(tree);
		assert.ok(outline.includes('projectMap.ts'));
		assert.ok(outline.includes('findCode.ts') || outline.includes('search'));
	});

	test('fixture: stale map после обновления индекса', () => {
		const cached: ProjectMapDocument = {
			updatedAt: '2026-01-01T00:00:00.000Z',
			source: 'index',
			fileCount: 2,
			maxDepth: 8,
			truncated: false,
			tree: [],
		};
		assert.strictEqual(isProjectMapStale(cached, '2026-09-01T00:00:00.000Z'), true);
		assert.strictEqual(isProjectMapStale(cached, '2026-01-01T00:00:00.000Z'), false);
	});
});
