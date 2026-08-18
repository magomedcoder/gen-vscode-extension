import * as vscode from 'vscode';

export async function offerAgentUndo(uris: vscode.Uri[]): Promise<void> {
	if (uris.length === 0) {
		return;
	}

	const counts = new Map<string, { uri: vscode.Uri; n: number }>();
	for (const uri of uris) {
		const key = uri.toString();
		const cur = counts.get(key) ?? { 
			uri, 
			n: 0 
		};
		cur.n += 1;
		counts.set(key, cur);
	}

	const choice = await vscode.window.showInformationMessage(
		`Агент изменил файлов: ${counts.size}. Отменить правки?`,
		'Отменить',
	);
	if (choice !== 'Отменить') {
		return;
	}

	for (const { uri, n } of [...counts.values()].reverse()) {
		await vscode.window.showTextDocument(uri, { 
			preview: false, 
			preserveFocus: false 
		});
		for (let i = 0; i < n; i += 1) {
			await vscode.commands.executeCommand('undo');
		}
	}
}
