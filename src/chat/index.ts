import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';
import { CHAT_VIEW_ID } from './ids';

export function registerChat(context: vscode.ExtensionContext): vscode.Disposable {
	const provider = new ChatViewProvider(context);

	return vscode.Disposable.from(
		vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand('gen.openChat', async () => {
			await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
		}),
	);
}
