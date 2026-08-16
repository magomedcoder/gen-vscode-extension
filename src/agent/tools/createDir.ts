import * as vscode from 'vscode';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../workspacePath';

export const createDirTool: ToolDefinition = {
	name: 'create_dir',
	description: 'Создать каталог в workspace (включая промежуточные).',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к каталогу',
			},
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		if (await pathExists(resolved.uri)) {
			const stat = await vscode.workspace.fs.stat(resolved.uri);
			if (stat.type & vscode.FileType.Directory) {
				return {
					ok: true,
					content: `Каталог уже есть: ${resolved.relative}`
				};
			}

			return {
				ok: false,
				content: `По этому пути уже есть файл: ${resolved.relative}`
			};
		}

		await vscode.workspace.fs.createDirectory(resolved.uri);
		return {
			ok: true,
			content: `Каталог создан: ${resolved.relative}`
		};
	},
};
