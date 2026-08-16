import * as vscode from 'vscode';
import { AGENT_LIMITS, looksBinary, previewText } from '../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { resolveWorkspacePath, throwIfAborted } from '../workspacePath';

export const readFileTool: ToolDefinition = {
	name: 'read_file',
	description: 'Прочитать текстовый файл из workspace. Можно указать диапазон строк (1-based, включительно).',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к файлу',
			},
			start_line: {
				type: 'integer',
				description: 'Первая строка (с 1)',
			},
			end_line: {
				type: 'integer',
				description: 'Последняя строка (включительно)',
			},
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		let raw: Uint8Array;
		try {
			raw = await vscode.workspace.fs.readFile(resolved.uri);
		} catch {
			return {
				ok: false,
				content: `Файл не найден: ${resolved.relative}`
			};
		}

		if (looksBinary(raw)) {
			return {
				ok: false,
				content: `Бинарный файл нельзя прочитать: ${resolved.relative}`
			};
		}

		if (raw.byteLength > AGENT_LIMITS.maxReadBytes) {
			return {
				ok: false,
				content: `Файл слишком большой (${raw.byteLength} байт, лимит ${AGENT_LIMITS.maxReadBytes})`,
			};
		}

		const text = new TextDecoder('utf8', { fatal: false }).decode(raw);
		const lines = text.split(/\r?\n/);
		const start = Math.max(1, asOptionalInt(args, 'start_line') ?? 1);
		const end = Math.min(lines.length, asOptionalInt(args, 'end_line') ?? lines.length);
		if (start > end) {
			return {
				ok: false,
				content: 'Некорректный диапазон строк'
			};
		}

		const numbered = lines.slice(start - 1, end).map((line, i) => `${String(start + i).padStart(6, ' ')}|${line}`);
		const body = numbered.join('\n');

		return {
			ok: true,
			content: previewText(
				`Файл: ${resolved.relative} (строки ${start}-${end} из ${lines.length})\n${body}`,
				AGENT_LIMITS.maxReadBytes,
			),
		};
	},
};
