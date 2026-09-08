import * as vscode from 'vscode';
import { computeMiniDiff, toDiffHunkPayloads } from '../../diff';
import { AGENT_LIMITS } from '../../policy';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { denyWriteOverUserEdits } from '../../userEdits';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../../workspacePath';
import { confirmOrSkip } from '../confirm';
import { enhanceSuccessfulWrite } from '../postEdit';

export const writeFileTool: ToolDefinition = {
	name: 'write_file',
	description: 'Создать или полностью перезаписать короткий текстовый файл (UTF-8). Для длинных файлов сначала короткая заготовка, дальше точечные правки (apply_patch или apply_workspace_edit) - большой content в JSON обрежется. Если файл уже правил пользователь после агента - write_file запрещён, используй точечные правки.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к файлу',
			},
			content: {
				type: 'string',
				description: 'Полное содержимое файла',
			},
		},
		required: ['path', 'content'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		const content = asString(args, 'content');
		const bytes = new TextEncoder().encode(content);
		if (bytes.byteLength > AGENT_LIMITS.maxWriteBytes) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.writeTooLarge', bytes.byteLength, AGENT_LIMITS.maxWriteBytes),
			};
		}

		const exists = await pathExists(resolved.uri);
		let before = '';
		if (exists) {
			const existingDoc = await vscode.workspace.openTextDocument(resolved.uri);
			before = existingDoc.getText();
			const userDiff = ctx.writes?.userDiff(resolved.uri, before);
			if (userDiff !== undefined) {
				return {
					ok: false,
					path: resolved.relative,
					content: denyWriteOverUserEdits(resolved.relative, userDiff),
				};
			}
		}

		if (exists) {
			const denied = await confirmOrSkip(ctx, vscode.l10n.t('agent.confirm.overwriteFile', resolved.relative), content);
			if (denied) {
				return {
					...denied,
					path: resolved.relative,
				};
			}
		} else {
			const denied = await confirmOrSkip(ctx, vscode.l10n.t('agent.confirm.createFile', resolved.relative), content);
			if (denied) {
				return {
					...denied,
					path: resolved.relative,
				};
			}
		}

		let doc: vscode.TextDocument | undefined;
		if (exists) {
			doc = await vscode.workspace.openTextDocument(resolved.uri);
			before = doc.getText();
			const userDiff = ctx.writes?.userDiff(resolved.uri, before);
			if (userDiff !== undefined) {
				return {
					ok: false,
					path: resolved.relative,
					content: denyWriteOverUserEdits(resolved.relative, userDiff),
				};
			}
		}

		const edit = new vscode.WorkspaceEdit();
		if (doc) {
			const last = Math.max(0, doc.lineCount - 1);
			edit.replace(doc.uri, new vscode.Range(0, 0, last, doc.lineAt(last).text.length), content);
		} else {
			edit.createFile(resolved.uri, {
				ignoreIfExists: false,
				contents: bytes,
			});
		}

		const applied = await vscode.workspace.applyEdit(edit);
		if (!applied) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.writeFailed', resolved.relative),
			};
		}

		await ctx.checkpoint?.remember(resolved.uri, resolved.relative, exists ? before : undefined);
		ctx.writes?.remember(resolved.uri, resolved.relative, content);
		ctx.trackMutation?.(resolved.uri);
		if (ctx.revealFile) {
			await ctx.revealFile(resolved.uri);
		}

		const mini = computeMiniDiff(before, content);
		return enhanceSuccessfulWrite({
			ok: true,
			path: resolved.relative,
			diff: mini.text,
			hunks: toDiffHunkPayloads(mini.hunks, before, { 
				path: resolved.relative 
			}),
			content: exists
				? vscode.l10n.t('tool.fileOverwritten', resolved.relative, bytes.byteLength)
				: vscode.l10n.t('tool.fileCreated', resolved.relative, bytes.byteLength),
		}, resolved.uri);
	},
};
