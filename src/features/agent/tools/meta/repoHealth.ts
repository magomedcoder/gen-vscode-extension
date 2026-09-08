import * as vscode from 'vscode';
import { previewText } from '../../policy';
import { asOptionalInt, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';

import { throwIfAborted } from '../../workspacePath';
import { listIndexableFiles, readIndexableText } from '../../../index/scanner';
import { buildImportGraph, findImportCycles, findOrphanFiles, isJsLikePath } from './repoHealthCore';

const DEFAULT_MAX_FILES = 800;

// MVP: циклы импортов TS/JS (regex) + orphan-файлы -> JSON-отчёт.
export const repoHealthTool: ToolDefinition = {
	name: 'repo_health',
	description: 'Скан TS/JS: эвристические циклы импортов и orphan-файлы (никто не импортирует). JSON-отчёт, без AST.',
	parameters: {
		type: 'object',
		properties: {
			max_files: {
				type: 'integer',
				description: `Макс. файлов для анализа (по умолчанию ${DEFAULT_MAX_FILES})`,
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return {
				ok: false,
				content: 'repo_health: нет workspace folder',
			};
		}

		const maxFiles = Math.min(2_000, Math.max(50, asOptionalInt(args, 'max_files') ?? DEFAULT_MAX_FILES));
		const scanned = await listIndexableFiles(folder);
		const jsFiles = scanned.filter((f) => isJsLikePath(f.relative)).slice(0, maxFiles);

		const sources: Array<{ path: string; source: string }> = [];
		for (const file of jsFiles) {
			throwIfAborted(ctx.signal);
			const text = await readIndexableText(file.uri);
			if (text === undefined) {
				continue;
			}
			
			sources.push({ 
				path: file.relative, 
				source: text 
			});
		}

		const graph = buildImportGraph(sources);
		const cycles = findImportCycles(graph);
		const orphans = findOrphanFiles(graph);

		const report = {
			scannedJs: sources.length,
			capped: scanned.filter((f) => isJsLikePath(f.relative)).length > maxFiles,
			cycleCount: cycles.length,
			cycles: cycles.slice(0, 20).map((c) => c.join(' -> ')),
			orphanCount: orphans.length,
			orphans: orphans.slice(0, 80),
			note: 'Эвристика regex (без AST); relative imports only; entrypoints/tests исключены из orphans',
		};

		return {
			ok: true,
			content: previewText(JSON.stringify(report, null, 2), 12_000),
		};
	},
};
