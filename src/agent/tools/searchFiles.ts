import * as vscode from 'vscode';
import { getSettings } from '../../config/settings';
import { AGENT_LIMITS, deniedDirectoryExcludeGlob, looksBinary } from '../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { resolveWorkspacePath, throwIfAborted } from '../workspacePath';

function toGlob(pattern: string): string {
	const trimmed = pattern.trim() || '**/*';
	if (/[*?\[]/.test(trimmed)) {
		return trimmed;
	}
	
	if (/\.[A-Za-z0-9]+$/.test(trimmed)) {
		return trimmed;
	}

	return trimmed.replace(/\/?$/, '/') + '**';
}

export const searchFilesTool: ToolDefinition = {
	name: 'search_files',
	description: 'Поиск файлов по glob и/или тексту внутри workspace. Учитывает запрещённые пути из настроек.',
	parameters: {
		type: 'object',
		properties: {
			glob: {
				type: 'string',
				description: 'Glob (например **/*.ts или src). По умолчанию **/*',
			},
			query: {
				type: 'string',
				description: 'Подстрока для поиска в содержимом. Если пусто - только список путей.',
			},
			max_results: {
				type: 'integer',
				description: 'Лимит совпадений',
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const glob = toGlob(asString(args, 'glob', '**/*'));
		const query = asString(args, 'query');
		const cap = Math.min(
			Math.max(1, asOptionalInt(args, 'max_results') ?? AGENT_LIMITS.maxSearchMatches),
			AGENT_LIMITS.maxSearchMatches,
		);

		const exclude = deniedDirectoryExcludeGlob(getSettings().deniedPaths);
		const uris = await vscode.workspace.findFiles(glob, exclude, AGENT_LIMITS.maxSearchFiles);
		if (!query) {
			const paths: string[] = [];
			for (const uri of uris.slice(0, cap)) {
				throwIfAborted(ctx.signal);
				try {
					const resolved = await resolveWorkspacePath(uri.fsPath);
					paths.push(resolved.relative);
				} catch {
					continue;
				}
			}
			return {
				ok: true,
				content: JSON.stringify({
					glob,
					truncated: uris.length > cap,
					files: paths,
				}, null, 2),
			};
		}

		const matches: Array<{
			path: string;
			line: number;
			text: string
		}> = [];

		let scanned = 0;
		for (const uri of uris) {
			throwIfAborted(ctx.signal);
			if (matches.length >= cap) {
				break;
			}

			scanned += 1;
			let raw: Uint8Array;
			try {
				raw = await vscode.workspace.fs.readFile(uri);
			} catch {
				continue;
			}

			if (looksBinary(raw) || raw.byteLength > AGENT_LIMITS.maxReadBytes) {
				continue;
			}

			let relative: string;
			try {
				relative = (await resolveWorkspacePath(uri.fsPath)).relative;
			} catch {
				continue;
			}

			const lines = new TextDecoder('utf8', { fatal: false }).decode(raw).split(/\r?\n/);
			for (let i = 0; i < lines.length; i += 1) {
				if (!lines[i].includes(query)) {
					continue;
				}

				matches.push({
					path: relative,
					line: i + 1,
					text: lines[i].trim().slice(0, 200),
				});
				if (matches.length >= cap) {
					break;
				}
			}
		}

		return {
			ok: true,
			content: JSON.stringify({
				glob,
				query,
				truncated: matches.length >= cap,
				scanned,
				matches,
			}, null, 2),
		};
	},
};
