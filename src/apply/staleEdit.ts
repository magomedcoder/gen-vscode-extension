import * as vscode from 'vscode';
import type { CodeFragment } from '../context/selection';

// Файл или выделение изменились, пока шла генерация комментариев
export async function isSelectionStale(fragment: CodeFragment): Promise<boolean> {
	let doc: vscode.TextDocument;
	try {
		doc = await vscode.workspace.openTextDocument(fragment.uri);
	} catch {
		return true;
	}

	if (doc.version === fragment.documentVersion) {
		return false;
	}

	try {
		return doc.getText(fragment.range) !== fragment.text;
	} catch {
		return true;
	}
}
