import * as path from 'node:path';
import * as vscode from 'vscode';
import { getFolderIgnoreMatcher, ignoresRelative } from '../../gitIgnore';
import { AGENT_LIMITS } from '../../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { resolveWorkspacePath, throwIfAborted } from '../../workspacePath';

export const listDirTool: ToolDefinition = {
	name: 'list_dir',
	description: 'Список файлов и папок в каталоге workspace. Путь относительный или абсолютный внутри проекта. В JSON есть legend («/ = directory»); имена каталогов оканчиваются на /.',
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
				content: vscode.l10n.t('tool.dirReadFailed', resolved.relative)
			};
		}

		const matcher = await getFolderIgnoreMatcher(resolved.folder.uri.fsPath);
		const parentRel = resolved.relative === '.' ? '' : resolved.relative;
		const visible = entries.filter(([name]) => {
			const childRel = parentRel ? path.posix.join(parentRel, name) : name;
			return !ignoresRelative(matcher, childRel);
		});

		const legend = vscode.l10n.t('tool.listDirLegend');
		const sliced = visible.slice(0, cap).map(([entryName, type]) => {
			const isDir = Boolean(type & vscode.FileType.Directory);
			const kind = isDir ? 'dir' : type & vscode.FileType.SymbolicLink ? 'link' : 'file';
			// Каталоги помечаем завершающим `/` (см. legend)
			const name = isDir ? `${entryName}/` : entryName;
			return { name, kind };
		});

		return {
			ok: true,
			content: JSON.stringify({
				path: resolved.relative,
				truncated: visible.length > cap,
				legend,
				entries: sliced,
			}, null, 2),
		};
	},
};
