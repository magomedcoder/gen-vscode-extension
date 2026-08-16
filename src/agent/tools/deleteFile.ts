import * as vscode from 'vscode';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../workspacePath';
import { confirmOrSkip } from './confirm';

export const deleteFileTool: ToolDefinition = {
	name: 'delete_file',
	description: 'Удалить файл в workspace. Всегда требует подтверждения пользователя. Папки не удаляет.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к файлу',
			},
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		if (!await pathExists(resolved.uri)) {
			return {
				ok: false,
				content: `Файл не найден: ${resolved.relative}`
			};
		}

		const stat = await vscode.workspace.fs.stat(resolved.uri);
		if (stat.type & vscode.FileType.Directory) {
			return {
				ok: false,
				content: `Это каталог, delete_file его не удаляет: ${resolved.relative}`
			};
		}

		const denied = await confirmOrSkip(ctx, `Удалить файл ${resolved.relative}?`);
		if (denied) {
			return denied;
		}

		await vscode.workspace.fs.delete(resolved.uri, {
			useTrash: true
		});
		return {
			ok: true,
			content: `Файл удалён: ${resolved.relative}`
		};
	},
};
