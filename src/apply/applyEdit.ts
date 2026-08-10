import * as vscode from 'vscode';

// Заменяет диапазон в документе через WorkspaceEdit
export async function applyReplacement(uri: vscode.Uri, range: vscode.Range, newText: string): Promise<boolean> {
	const edit = new vscode.WorkspaceEdit();
	edit.replace(uri, range, newText);
	return vscode.workspace.applyEdit(edit);
}
