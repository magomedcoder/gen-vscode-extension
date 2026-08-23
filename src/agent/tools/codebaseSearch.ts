import { getIndexManager } from '../../index/IndexManager';
import { AGENT_LIMITS } from '../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { throwIfAborted } from '../workspacePath';

export const codebaseSearchTool: ToolDefinition = {
	name: 'codebase_search',
	description: 'Поиск по проиндексированной кодовой базе (триграммы). Быстрее обзора большого проекта, чем search_files. Индекс в .gen/index/.',
	parameters: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Что искать: имя символа, фраза, путь, концепция',
			},
			max_results: {
				type: 'integer',
				description: 'Лимит фрагментов',
			},
		},
		required: ['query'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const query = asString(args, 'query').trim();
		if (!query) {
			return { 
				ok: false, 
				content: 'Нужен query' 
			};
		}

		const cap = Math.min(
			Math.max(1, asOptionalInt(args, 'max_results') ?? 15),
			AGENT_LIMITS.maxSearchMatches,
		);

		const manager = getIndexManager();
		if (!manager) {
			return {
				ok: false,
				content: 'Индекс не инициализирован (нет workspace?)',
			};
		}

		const progress = manager.getProgress();
		if (progress.state === 'indexing') {
			return {
				ok: true,
				content: JSON.stringify({
					query,
					indexing: true,
					hits: [],
					hint: 'Индекс ещё строится - повторите поиск через несколько секунд',
				}, null, 2),
			};
		}

		const hits = await manager.search(query, cap);
		return {
			ok: true,
			content: JSON.stringify({
				query,
				indexState: progress.state,
				fileCount: progress.fileCount,
				chunkCount: progress.chunkCount,
				hits,
			}, null, 2),
		};
	},
};
