import * as vscode from 'vscode';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../../workspacePath';

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
					content: vscode.l10n.t('tool.dirExists', resolved.relative)
				};
			}

			return {
				ok: false,
				content: vscode.l10n.t('tool.pathIsFile', resolved.relative)
			};
		}

		await ctx.checkpoint?.remember(resolved.uri, resolved.relative, undefined);
		await vscode.workspace.fs.createDirectory(resolved.uri);
		ctx.trackMutation?.(resolved.uri);
		return {
			ok: true,
			path: resolved.relative,
			content: vscode.l10n.t('tool.dirCreated', resolved.relative)
		};
	},
};
