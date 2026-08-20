import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';
import { CHAT_VIEW_ID } from './ids';
import { setConfirmHost } from '../ui/confirmDialog';

export function registerChat(context: vscode.ExtensionContext): vscode.Disposable {
	const provider = new ChatViewProvider(context);
	setConfirmHost((options) => provider.requestConfirm(options));

	return vscode.Disposable.from(
		{
			dispose: () => setConfirmHost(undefined),
		},
		vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand('gen.openChat', async () => {
			await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
		}),
	);
}
