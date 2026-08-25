import * as vscode from 'vscode';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../workspacePath';
import { confirmOrSkip, shouldConfirmDeletes } from './confirm';

export const deleteFileTool: ToolDefinition = {
	name: 'delete_file',
	description: 'Удалить файл в workspace. В режиме «Спросить» требует подтверждения. Папки не удаляет.',
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
				content: vscode.l10n.t('tool.fileNotFound', resolved.relative)
			};
		}

		const stat = await vscode.workspace.fs.stat(resolved.uri);
		if (stat.type & vscode.FileType.Directory) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.isDirectory', resolved.relative)
			};
		}

		if (shouldConfirmDeletes()) {
			const denied = await confirmOrSkip(ctx, vscode.l10n.t('agent.confirm.deleteFile', resolved.relative));
			if (denied) {
				return {
					...denied,
					path: resolved.relative
				};
			}
		}

		const doc = await vscode.workspace.openTextDocument(resolved.uri);
		await ctx.checkpoint?.remember(resolved.uri, resolved.relative, doc.getText());
		await vscode.workspace.fs.delete(resolved.uri, {
			useTrash: true
		});
		ctx.writes?.forget(resolved.uri);
		ctx.trackMutation?.(resolved.uri);
		return {
			ok: true,
			path: resolved.relative,
			content: vscode.l10n.t('tool.fileDeleted', resolved.relative)
		};
	},
};
