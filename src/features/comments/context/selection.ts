import * as path from 'path';
import * as vscode from 'vscode';

// Фрагмент кода для отправки в llm и последующей замены в редакторе
export interface CodeFragment {
	uri: vscode.Uri;
	range: vscode.Range;
	text: string;
	languageId: string;
	fileName: string;
	documentVersion: number;
}

// Активный текстовый редактор или undefined
export function getActiveEditor(): vscode.TextEditor | undefined {
	return vscode.window.activeTextEditor;
}

// Фрагмент по текущему выделению; undefined если выделения нет
export function getSelectionFragment(editor: vscode.TextEditor): CodeFragment | undefined {
	const selection = editor.selection;
	if (selection.isEmpty) {
		return undefined;
	}

	const text = editor.document.getText(selection);
	if (!text.trim()) {
		return undefined;
	}

	return toFragment(editor, selection, text);
}

// Фрагмент по всему открытому файлу; undefined если файл пустой
export function getFileFragment(editor: vscode.TextEditor): CodeFragment | undefined {
	const doc = editor.document;
	const text = doc.getText();
	if (!text.trim()) {
		return undefined;
	}

	const lastLine = Math.max(0, doc.lineCount - 1);
	const range = new vscode.Range(0, 0, lastLine, doc.lineAt(lastLine).text.length);
	return toFragment(editor, range, text);
}

// Собирает CodeFragment из редактора и диапазона
export function toFragment(editor: vscode.TextEditor, range: vscode.Range, text: string): CodeFragment {
	return {
		uri: editor.document.uri,
		range,
		text,
		languageId: editor.document.languageId,
		fileName: path.basename(editor.document.fileName),
		documentVersion: editor.document.version,
	};
}
