import * as vscode from 'vscode';
import { registerChat } from './chat';
import { registerCommentSelection } from './commands/commentSelection';
import { registerCommentFile } from './commands/commentFile';
import { initSettings } from './config/settings';
import { initIndexManager } from './index/IndexManager';
import { initLogger } from './log/logger';
import { initFileWatcherHooks } from './project/fileWatcherHooks';
import { initGenRulesManager } from './project/genrules';
import { DiffContentProvider, registerDiffContentProvider } from './preview/showDiff';

import { initActivityStore } from './stores/activityStore';
import { initUsageStore } from './stores/usageStore';

export function activate(context: vscode.ExtensionContext): void {
	initSettings(context);
	initLogger(context);
	initIndexManager(context);
	initGenRulesManager(context);
	initFileWatcherHooks(context);
	initUsageStore(context);
	initActivityStore(context);

	const diffProvider = new DiffContentProvider();

	context.subscriptions.push(
		registerDiffContentProvider(diffProvider),
		registerCommentSelection(diffProvider),
		registerCommentFile(diffProvider),
		registerChat(context),
	);
}

export function deactivate(): void {
	console.log('deactivate');
}
