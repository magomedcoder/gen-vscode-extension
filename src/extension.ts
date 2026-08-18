import * as vscode from 'vscode';
import { registerChat } from './chat';
import { registerCommentFunction } from './commands/commentFunction';
import { registerCommentSelection } from './commands/commentSelection';
import { initSettings } from './config/settings';
import { initAgentAudit } from './agent/audit';
import { DiffContentProvider } from './preview/showDiff';

export function activate(context: vscode.ExtensionContext): void {
	initSettings(context);
	initAgentAudit(context);

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
