import * as vscode from 'vscode';
import { asBoolean, asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { resolveWorkspacePath, throwIfAborted } from '../../workspacePath';

function lineRange(line: number, endLine?: number): vscode.Range {
	const start = Math.max(0, line - 1);
	const end = Math.max(start, (endLine ?? line) - 1);
	return new vscode.Range(start, 0, end, 0);
}

async function showAt(uri: vscode.Uri, line?: number, endLine?: number, preview = true): Promise<void> {
	const options: vscode.TextDocumentShowOptions = {
		preview,
		preserveFocus: false
	};
	if (line !== undefined) {
		const range = lineRange(line, endLine);
		options.selection = range;
	}

	await vscode.window.showTextDocument(uri, options);
}

export const openFileTool: ToolDefinition = {
	name: 'open_file',
	description: 'Открыть файл workspace в редакторе. Не меняет содержимое.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к файлу'
			},
			line: {
				type: 'integer',
				description: 'Строка (с 1), на которую прокрутить'
			},
			preview: {
				type: 'boolean',
				description: 'Открыть как preview-вкладку (по умолчанию true)'
			},
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		await showAt(resolved.uri, asOptionalInt(args, 'line'), undefined, asBoolean(args, 'preview', true));
		return {
			ok: true,
			content: vscode.l10n.t('tool.opened', resolved.relative)
		};
	},
};

export const revealLineTool: ToolDefinition = {
	name: 'reveal_line',
	description: 'Показать файл и перейти к строке (диапазону) без правки содержимого.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к файлу'
			},
			line: {
				type: 'integer',
				description: 'Первая строка (с 1)'
			},
			end_line: {
				type: 'integer',
				description: 'Последняя строка (включительно)'
			},
		},
		required: ['path', 'line'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		const line = asOptionalInt(args, 'line');
		if (!line || line < 1) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.needLine')
			};
		}

		await showAt(resolved.uri, line, asOptionalInt(args, 'end_line'), true);
		return {
			ok: true,
			content: vscode.l10n.t('tool.revealed', resolved.relative, line)
		};
	},
};

export const closeFileTool: ToolDefinition = {
	name: 'close_file',
	description: 'Закрыть вкладку файла. Грязные (несохранённые) вкладки не закрывает.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к файлу'
			},
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		const target = resolved.uri.toString();
		const tabs: vscode.Tab[] = [];
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === target) {
					tabs.push(tab);
				}
			}
		}

		if (tabs.length === 0) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.tabNotOpen', resolved.relative)
			};
		}

		if (tabs.some((tab) => tab.isDirty)) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.unsavedCloseDenied', resolved.relative)
			};
		}

		await vscode.window.tabGroups.close(tabs, true);
		return {
			ok: true,
			content: vscode.l10n.t('tool.closed', resolved.relative)
		};
	},
};
