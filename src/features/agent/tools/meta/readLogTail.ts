import * as vscode from 'vscode';
import { AGENT_LIMITS } from '../../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../../workspacePath';

export const readLogTailTool: ToolDefinition = {
	name: 'read_log_tail',
	description: 'Прочитать хвост лог-файла (последние N строк). Для Debug Mode: ошибки, stack traces, последние события.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к лог-файлу относительно workspace',
			},
			lines: {
				type: 'integer',
				description: 'Сколько последних строк (по умолчанию 120, макс. 200)',
			},
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		if (!(await pathExists(resolved.uri))) {
			return {
				ok: false,
				path: resolved.relative,
				content: vscode.l10n.t('tool.fileNotFound', resolved.relative),
			};
		}

		const wantLines = Math.min(
			Math.max(1, asOptionalInt(args, 'lines') ?? 120),
			AGENT_LIMITS.maxLogTailLines,
		);

		const bytes = await vscode.workspace.fs.readFile(resolved.uri);
		if (bytes.byteLength > AGENT_LIMITS.maxReadBytes) {
			return {
				ok: false,
				path: resolved.relative,
				content: vscode.l10n.t('tool.logTooLarge', resolved.relative),
			};
		}

		const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
		const allLines = text.split(/\r?\n/);
		const slice = allLines.slice(Math.max(0, allLines.length - wantLines));
		let body = slice.join('\n');
		let truncated = false;
		if (body.length > AGENT_LIMITS.maxLogTailBytes) {
			body = body.slice(body.length - AGENT_LIMITS.maxLogTailBytes);
			truncated = true;
		}

		return {
			ok: true,
			path: resolved.relative,
			content: JSON.stringify({
				path: resolved.relative,
				totalLines: allLines.length,
				returnedLines: slice.length,
				truncated,
				tail: body,
			}, null, 2),
		};
	},
};
