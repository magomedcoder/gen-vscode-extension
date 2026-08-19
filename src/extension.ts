import * as vscode from 'vscode';
import { registerChat } from './chat';
import { registerCommentSelection } from './commands/commentSelection';
import { initSettings } from './config/settings';
import { initLogger } from './log/logger';
import { DiffContentProvider } from './preview/showDiff';

export function activate(context: vscode.ExtensionContext): void {
	initSettings(context);
	initLogger(context);

	const diffProvider = new DiffContentProvider();

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider('gen-comment', diffProvider),
		registerCommentSelection(diffProvider),
		registerChat(context),
	);
}

export function deactivate(): void {
	console.log('deactivate');
}
