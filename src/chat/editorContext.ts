import * as path from 'node:path';
import * as vscode from 'vscode';

const MAX_SELECTION_CHARS = 4000;

export function getEditorChatContext(): string | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}

	const fileName = path.basename(editor.document.fileName);
	const languageId = editor.document.languageId;
	const selected = editor.selection.isEmpty ? '' : editor.document.getText(editor.selection).trim();

	const lines = [`Файл: ${fileName} (${languageId})`];
	if (selected) {
		const clipped = selected.length > MAX_SELECTION_CHARS
			? `${selected.slice(0, MAX_SELECTION_CHARS)}\n...`
			: selected;
		lines.push('Выделение:', clipped);
	}

	return lines.join('\n');
}
