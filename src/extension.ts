import * as vscode from 'vscode';

const decorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(245, 12, 12, 0.72)',
});

function decorateWords() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	const text = editor.document.getText();
	const regex = /\b(FIXME|TODO|BUG)\b/g;

	const ranges = [...text.matchAll(regex)].map((match) => {
		const startPos = editor.document.positionAt(match.index);
		const endPos = editor.document.positionAt(match.index + match[0].length);

		console.log('<<----')
		console.log(startPos)
		console.log(endPos)
		console.log('---->>')

		return new vscode.Range(startPos, endPos);
	});

	editor.setDecorations(decorationType, ranges);
}

export function activate(context: vscode.ExtensionContext) {
	console.log('activate');

	vscode.workspace.onDidChangeTextDocument(decorateWords, null, context.subscriptions);
	vscode.window.onDidChangeActiveTextEditor(decorateWords, null, context.subscriptions);

	const disposable = vscode.commands.registerCommand('gen.main', () => {
		// vscode.window.showInformationMessage('Привет');
		decorateWords();
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {
	console.log('deactivate');
}