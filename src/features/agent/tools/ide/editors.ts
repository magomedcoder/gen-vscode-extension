import * as vscode from 'vscode';
import { AGENT_LIMITS } from '../../policy';
import { type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { relativeFromUri, throwIfAborted } from '../../workspacePath';

function positionJson(pos: vscode.Position): { line: number; character: number } {
	return {
		line: pos.line + 1,
		character: pos.character + 1
	};
}

async function editorPayload(editor: vscode.TextEditor): Promise<Record<string, unknown>> {
	const selection = editor.document.getText(editor.selection);
	const clipped = selection.length > AGENT_LIMITS.maxSelectionChars
		? `${selection.slice(0, AGENT_LIMITS.maxSelectionChars)}\n...`
		: selection;

	return {
		path: await relativeFromUri(editor.document.uri),
		languageId: editor.document.languageId,
		dirty: editor.document.isDirty,
		untitled: editor.document.isUntitled,
		cursor: positionJson(editor.selection.active),
		selection: editor.selection.isEmpty
			? null
			: {
				start: positionJson(editor.selection.start),
				end: positionJson(editor.selection.end),
				text: clipped,
			},
	};
}

export const getActiveEditorTool: ToolDefinition = {
	name: 'get_active_editor',
	description: 'Активный текстовый редактор: путь, язык, курсор, выделение.',
	parameters: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	async execute(_args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return {
				ok: true,
				content: JSON.stringify({
					editor: null
				}, null, 2)
			};
		}
		return {
			ok: true,
			content: JSON.stringify({
				editor: await editorPayload(editor)
			}, null, 2),
		};
	},
};

export const getOpenEditorsTool: ToolDefinition = {
	name: 'get_open_editors',
	description: 'Список открытых текстовых вкладок workspace (путь, язык, dirty).',
	parameters: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	async execute(_args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const tabs: Array<Record<string, unknown>> = [];
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				if (!(tab.input instanceof vscode.TabInputText)) {
					continue;
				}

				const uri = tab.input.uri;
				const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
				tabs.push({
					path: await relativeFromUri(uri),
					languageId: doc?.languageId ?? null,
					dirty: tab.isDirty,
					active: tab.isActive,
					preview: tab.isPreview,
				});
			}
		}

		return {
			ok: true,
			content: JSON.stringify({
				count: tabs.length,
				editors: tabs
			}, null, 2),
		};
	},
};
