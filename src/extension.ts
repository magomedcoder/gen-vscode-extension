import * as vscode from 'vscode';
import { registerChat } from './chat/ChatViewProvider';
import { registerCommentFunction } from './commands/commentFunction';
import { registerCommentSelection } from './commands/commentSelection';
import { DiffContentProvider } from './preview/showDiff';

export function activate(context: vscode.ExtensionContext): void {
	const diffProvider = new DiffContentProvider();

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider('gen-comment', diffProvider),
		registerCommentSelection(diffProvider),
		registerCommentFunction(diffProvider),
		registerChat(context),
	);
}

export function deactivate(): void {
	console.log('deactivate');
}
