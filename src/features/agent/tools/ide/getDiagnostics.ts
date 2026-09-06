import * as vscode from 'vscode';
import { AGENT_LIMITS } from '../../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { relativeFromUri, resolveWorkspacePath, throwIfAborted } from '../../workspacePath';

const SEVERITY: Record<number, string> = {
	[vscode.DiagnosticSeverity.Error]: 'error',
	[vscode.DiagnosticSeverity.Warning]: 'warning',
	[vscode.DiagnosticSeverity.Information]: 'info',
	[vscode.DiagnosticSeverity.Hint]: 'hint',
};

export const getDiagnosticsTool: ToolDefinition = {
	name: 'get_diagnostics',
	description: 'Диагностики редактора (ошибки TypeScript, ESLint и т.д.) для файла или всего workspace.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Файл. Если не задан - по всему workspace (с лимитом).',
			},
			max_results: {
				type: 'integer',
				description: 'Максимум записей',
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const cap = Math.min(
			Math.max(1, asOptionalInt(args, 'max_results') ?? AGENT_LIMITS.maxDiagnostics),
			AGENT_LIMITS.maxDiagnostics,
		);
		const pathArg = asString(args, 'path');

		let entries: Array<[vscode.Uri, vscode.Diagnostic[]]>;
		if (pathArg) {
			const resolved = await resolveWorkspacePath(pathArg);
			entries = [[resolved.uri, vscode.languages.getDiagnostics(resolved.uri)]];
		} else {
			entries = vscode.languages.getDiagnostics();
		}

		const items: Array<Record<string, unknown>> = [];
		let total = 0;
		for (const [uri, diags] of entries) {
			throwIfAborted(ctx.signal);
			const file = await relativeFromUri(uri);
			for (const diag of diags) {
				total += 1;
				if (items.length >= cap) {
					continue;
				}

				items.push({
					path: file,
					line: diag.range.start.line + 1,
					character: diag.range.start.character + 1,
					severity: SEVERITY[diag.severity] ?? String(diag.severity),
					source: diag.source ?? null,
					message: diag.message,
				});
			}
		}

		return {
			ok: true,
			content: JSON.stringify({
				truncated: total > items.length,
				count: items.length,
				total,
				diagnostics: items,
			}, null, 2),
		};
	},
};
