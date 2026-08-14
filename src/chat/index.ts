import * as vscode from 'vscode';
import { ChatViewProvider, CHAT_VIEW_ID } from './ChatViewProvider';

export function registerChat(context: vscode.ExtensionContext): vscode.Disposable {
	const provider = new ChatViewProvider(context);

	return vscode.Disposable.from(
		vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand('gen.openChat', async () => {
			await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
			provider.showScreen('chat');
		}),
		vscode.commands.registerCommand('gen.openSettings', async () => {
			await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
			provider.showScreen('settings');
		}),
	);
}
