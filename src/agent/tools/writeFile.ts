import * as vscode from 'vscode';
import { AGENT_LIMITS } from '../policy';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../workspacePath';
import { confirmOrSkip, shouldConfirmWrites } from './confirm';

export const writeFileTool: ToolDefinition = {
	name: 'write_file',
	description: 'Создать файл или полностью перезаписать текстовый файл в workspace (UTF-8).',
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
		if (exists && shouldConfirmWrites()) {
			const denied = await confirmOrSkip(
				ctx,
				`Перезаписать файл ${resolved.relative}?`,
				content,
			);
			if (denied) {
				return denied;
			}
		}

		await vscode.workspace.fs.writeFile(resolved.uri, bytes);
		if (ctx.revealFile) {
			await ctx.revealFile(resolved.uri);
		}

		return {
			ok: true,
			content: exists
				? `Файл перезаписан: ${resolved.relative} (${bytes.byteLength} байт)`
				: `Файл создан: ${resolved.relative} (${bytes.byteLength} байт)`,
		};
	},
};
