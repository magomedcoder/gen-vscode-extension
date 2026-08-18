import * as vscode from 'vscode';
import { formatMiniDiff } from '../diff';
import { AGENT_LIMITS } from '../policy';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../workspacePath';
import { confirmOrSkip, shouldConfirmWrites } from './confirm';

export const writeFileTool: ToolDefinition = {
	name: 'write_file',
	description: 'Создать или полностью перезаписать короткий текстовый файл (UTF-8). Для длинных файлов сначала заготовка, затем apply_patch кусками - большой content в JSON обрежется.',
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
				content: `Слишком большой write (${bytes.byteLength} байт, лимит ${AGENT_LIMITS.maxWriteBytes})`,
			};
		}

		const exists = await pathExists(resolved.uri);
		let before = '';
		let existingDoc: vscode.TextDocument | undefined;
		if (exists) {
			existingDoc = await vscode.workspace.openTextDocument(resolved.uri);
			before = existingDoc.getText();
		}

		if (exists && shouldConfirmWrites()) {
			const denied = await confirmOrSkip(
				ctx,
				`Перезаписать файл ${resolved.relative}?`,
				content,
			);
			if (denied) {
				return {
					...denied,
					path: resolved.relative
				};
			}
		}

		const edit = new vscode.WorkspaceEdit();
		if (existingDoc) {
			const last = Math.max(0, existingDoc.lineCount - 1);
			edit.replace(existingDoc.uri, new vscode.Range(0, 0, last, existingDoc.lineAt(last).text.length), content);
		} else {
			edit.createFile(resolved.uri, {
				ignoreIfExists: false,
				contents: bytes
			});
		}

		const applied = await vscode.workspace.applyEdit(edit);
		if (!applied) {
			return {
				ok: false,
				content: `Не удалось записать: ${resolved.relative}`
			};
		}

		await ctx.checkpoint?.remember(resolved.uri, resolved.relative, exists ? before : undefined);
		ctx.trackMutation?.(resolved.uri);
		if (ctx.revealFile) {
			await ctx.revealFile(resolved.uri);
		}

		return {
			ok: true,
			path: resolved.relative,
			diff: formatMiniDiff(before, content),
			content: exists
				? `Файл перезаписан: ${resolved.relative} (${bytes.byteLength} байт)`
				: `Файл создан: ${resolved.relative} (${bytes.byteLength} байт)`,
		};
	},
};
