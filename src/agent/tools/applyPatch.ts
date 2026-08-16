import * as vscode from 'vscode';
import { applySearchReplace } from '../patch';
import { AGENT_LIMITS } from '../policy';
import { asBoolean, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../workspacePath';
import { confirmOrSkip, shouldConfirmWrites } from './confirm';

export const applyPatchTool: ToolDefinition = {
	name: 'apply_patch',
	description: 'Точечная правка файла: заменить old_string на new_string. Для нового файла используйте write_file.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к существующему файлу',
			},
			old_string: {
				type: 'string',
				description: 'Уникальный фрагмент, который нужно заменить',
			},
			new_string: {
				type: 'string',
				description: 'Новый фрагмент',
			},
			replace_all: {
				type: 'boolean',
				description: 'Заменить все вхождения (по умолчанию false)',
			},
		},
		required: ['path', 'old_string', 'new_string'],
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

		const raw = await vscode.workspace.fs.readFile(resolved.uri);
		if (raw.byteLength > AGENT_LIMITS.maxReadBytes) {
			return {
				ok: false,
				content: `Файл слишком большой для patch: ${resolved.relative}`
			};
		}

		const original = new TextDecoder('utf8', { fatal: false }).decode(raw);
		let next: {
			text: string;
			count: number
		};
		try {
			next = applySearchReplace(
				original,
				asString(args, 'old_string'),
				asString(args, 'new_string'),
				asBoolean(args, 'replace_all'),
			);
		} catch (err) {
			return {
				ok: false,
				content: err instanceof Error ? err.message : String(err)
			};
		}

		const encoded = new TextEncoder().encode(next.text);
		if (encoded.byteLength > AGENT_LIMITS.maxWriteBytes) {
			return {
				ok: false,
				content: 'Результат patch превышает лимит записи'
			};
		}

		if (shouldConfirmWrites()) {
			const denied = await confirmOrSkip(ctx, `Применить правку к ${resolved.relative}? (${next.count} замен)`, asString(args, 'new_string'));
			if (denied) {
				return denied;
			}
		}

		await vscode.workspace.fs.writeFile(resolved.uri, encoded);
		if (ctx.revealFile) {
			await ctx.revealFile(resolved.uri);
		}

		return {
			ok: true,
			content: `Правка применена: ${resolved.relative} (${next.count} замен)`,
		};
	},
};
