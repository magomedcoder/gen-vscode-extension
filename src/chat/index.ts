import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';
import { focusChatView } from './focusChat';
import { registerHunkCodeLens } from './hunkCodeLens';
import { CHAT_VIEW_ID, CHAT_VIEW_SIDEBAR_ID } from './ids';
import { getSettings } from '../config/settings';
import { setConfirmHost } from '../ui/confirmDialog';
import { ensureTerminalBufferListener } from './terminalBuffer';

export function registerChat(context: vscode.ExtensionContext): vscode.Disposable {
	// Одна сессия / один provider на panel + sidebar
	const provider = new ChatViewProvider(context);
	setConfirmHost((options) => provider.requestConfirm(options));

	const webviewOpts = { webviewOptions: { retainContextWhenHidden: true } };

	const disposable = vscode.Disposable.from(
		ensureTerminalBufferListener(),
		{
			dispose: () => setConfirmHost(undefined),
		},
		vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, provider, webviewOpts),
		vscode.window.registerWebviewViewProvider(CHAT_VIEW_SIDEBAR_ID, provider, webviewOpts),
		registerHunkCodeLens(provider.getSession()),
		vscode.commands.registerCommand('gen.openChat', async () => {
			await focusChatView();
		}),
		vscode.commands.registerCommand('gen.openChatPanel', async () => {
			await focusChatView('panel');
		}),
		vscode.commands.registerCommand('gen.openChatSidebar', async () => {
			await focusChatView('sidebar');
		}),
		vscode.commands.registerCommand('gen.addSelectionToChat', async () => {
			await provider.addSelectionToChat();
		}),
	);

	// После регистрации: при одном месте показа - сразу сфокусировать
	const location = getSettings().chatViewLocation;
	if (location === 'sidebar') {
		void vscode.commands.executeCommand(`${CHAT_VIEW_SIDEBAR_ID}.focus`);
	} else if (location === 'panel') {
		void vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
	}

	return disposable;
}
