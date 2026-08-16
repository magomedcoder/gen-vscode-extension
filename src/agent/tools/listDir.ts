import * as vscode from 'vscode';
import { AGENT_LIMITS } from '../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { resolveWorkspacePath, throwIfAborted } from '../workspacePath';

export const listDirTool: ToolDefinition = {
	name: 'list_dir',
	description: 'Список файлов и папок в каталоге workspace. Путь относительный или абсолютный внутри проекта.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Каталог (по умолчанию корень workspace)',
			},
			max_entries: {
				type: 'integer',
				description: `Максимум записей (по умолчанию ${AGENT_LIMITS.maxListEntries})`,
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path', '.'));
		const cap = Math.min(
			Math.max(1, asOptionalInt(args, 'max_entries') ?? AGENT_LIMITS.maxListEntries),
			AGENT_LIMITS.maxListEntries,
		);

		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(resolved.uri);
		} catch {
			return {
				ok: false,
				content: `Не удалось прочитать каталог: ${resolved.relative}`
			};
		}

		const sliced = entries.slice(0, cap).map(([name, type]) => {
			const kind = type & vscode.FileType.Directory ? 'dir' : type & vscode.FileType.SymbolicLink ? 'link' : 'file';
			return { name, kind };
		});

		return {
			ok: true,
			content: JSON.stringify({
				path: resolved.relative,
				truncated: entries.length > cap,
				entries: sliced,
			}, null, 2),
		};
	},
};
