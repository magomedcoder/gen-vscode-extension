import * as vscode from 'vscode';
import { getIndexManager } from '../../../index/IndexManager';
import { packContext, type ContextHit } from '../../../index/contextEngine';
import { isProjectEnabled } from '../../../project/config';
import { AGENT_LIMITS } from '../../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';
import { findCodeTool } from './findCode';

const DEFAULT_BUDGET = 12_000;
const MAX_BUDGET = 48_000;

// Собрать компактный context pack по запросу (find_code + codebase hits под budget).
export const packContextTool: ToolDefinition = {
	name: 'pack_context',
	description: 'По тексту задачи собрать компактный набор фрагментов кода (find_code + индекс) в пределах token/char budget.',
	parameters: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Задача / вопрос / что искать в кодовой базе',
			},
			budget_chars: {
				type: 'integer',
				description: `Лимит символов контекста (по умолчанию ${DEFAULT_BUDGET}, max ${MAX_BUDGET})`,
			},
			max_hits: {
				type: 'integer',
				description: 'Сколько сырых hits запросить у find_code / индекса (по умолчанию 16)',
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
				content: 'pack_context: нужен параметр query',
			};
		}

		const budget = Math.min(
			MAX_BUDGET,
			Math.max(1_000, asOptionalInt(args, 'budget_chars') ?? DEFAULT_BUDGET),
		);
		const maxHits = Math.min(
			AGENT_LIMITS.maxSearchMatches,
			Math.max(4, asOptionalInt(args, 'max_hits') ?? 16),
		);

		if (!vscode.workspace.workspaceFolders?.length) {
			return {
				ok: true,
				content: JSON.stringify({ 
					query, 
					hits: [], 
					text: '', 
					notes: ['нет workspace'] 
				}, null, 2),
			};
		}

		const hits: ContextHit[] = [];
		const notes: string[] = [];

		// гибрид find_code
		try {
			const fc = await findCodeTool.execute({
				query,
				intent: 'mixed',
				max_results: maxHits,
			}, ctx);
			if (fc.ok) {
				const parsed = JSON.parse(fc.content) as {
					hits?: Array<{ 
						path: string; 
						line?: number; 
						snippet?: string; 
						score?: number 
					}>;
					notes?: string[];
				};
				for (const h of parsed.hits ?? []) {
					hits.push({
						source: 'codebase',
						path: h.path,
						startLine: h.line,
						score: (h.score ?? 0.5) * 10,
						snippet: (h.snippet ?? h.path).slice(0, 1_200),
					});
				}
				if (parsed.notes?.length) {
					notes.push(...parsed.notes);
				}
			} else {
				notes.push(`find_code: ${fc.content}`);
			}
		} catch (err) {
			notes.push(`find_code: ${err instanceof Error ? err.message : String(err)}`);
		}

		// Дополнительно trigram index
		if (await isProjectEnabled()) {
			const manager = getIndexManager();
			if (manager) {
				try {
					const ranked = await manager.search(query, Math.min(8, maxHits));
					for (const h of ranked) {
						hits.push({
							source: 'codebase',
							path: h.path,
							startLine: h.startLine,
							endLine: h.endLine,
							score: h.score,
							snippet: h.snippet.slice(0, 1_200),
						});
					}
				} catch (err) {
					notes.push(`codebase: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}

		const pack = packContext(hits, budget);
		return {
			ok: true,
			content: JSON.stringify({
				query,
				budgetChars: budget,
				hitCount: pack.hits.length,
				notes,
				text: pack.text,
			}, null, 2).slice(0, budget + 2_000),
		};
	},
};
