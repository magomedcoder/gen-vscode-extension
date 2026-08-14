import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings } from '../config/settings';

export function getEditorChatContext(): string | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}

	const maxChars = getSettings().maxInputChars;
	const fileName = path.basename(editor.document.fileName);
	const languageId = editor.document.languageId;
	const selected = editor.selection.isEmpty ? '' : editor.document.getText(editor.selection).trim();

	const lines = [`Файл: ${fileName} (${languageId})`];
	if (selected) {
		const clipped = selected.length > maxChars
			? `${selected.slice(0, maxChars)}\n...`
			: selected;
		lines.push('Выделение:', clipped);
	}

	return lines.join('\n');
}
