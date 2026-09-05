import * as vscode from 'vscode';
import { createNonce, renderChatHtml } from './chatHtml';
import { suggestMentions } from './mentionSuggest';
import type { ChatProjectStatus, FromWebviewMessage, ToWebviewMessage } from './protocol';
import { ChatSession } from './ChatSession';
import { HttpLlmClient } from '../llm/client';
import { onSettingsChanged } from '../config/settings';
import { loadWebviewL10n } from '../l10n/loadBundle';
import { SettingsPanel } from './SettingsPanel';
import type { ConfirmDialogOptions } from '../ui/confirmDialog';
import { enableProject, isProjectEnabled } from '../project/config';
import { getIndexManager } from '../index/IndexManager';

export class ChatViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private readonly session: ChatSession;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.session = new ChatSession(context, new HttpLlmClient());
		this.session.subscribe(() => {
			void this.postState();
		});
		onSettingsChanged(() => {
			void this.postState();
		});
		getIndexManager()?.onDidChange(() => {
			void this.postState();
		});
	}

	requestConfirm(options: ConfirmDialogOptions) {
		return this.session.requestConfirm({
			title: options.title,
			detail: options.detail,
			hint: vscode.l10n.t('confirm.panelHint'),
			variant: options.variant,
			applyLabel: options.applyLabel,
			rejectLabel: options.rejectLabel,
		});
	}

	addSelectionToChat(): Promise<void> {
		return this.session.addSelectionToChat();
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;

		const assetsRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [assetsRoot],
		};

		const l10n = loadWebviewL10n(this.context.extensionUri);
		webviewView.webview.html = renderChatHtml({
			cspSource: webviewView.webview.cspSource,
			nonce: createNonce(),
			scriptUri: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.js')),
			styleUri: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.css')),
			title: l10n.strings['chat.webviewTitle'],
			screen: 'chat',
			l10n,
		});

		const messageSub = webviewView.webview.onDidReceiveMessage((msg: FromWebviewMessage) => {
			void this.onWebviewMessage(msg);
		});

		webviewView.onDidDispose(() => {
			messageSub.dispose();
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});
	}

	private post(message: ToWebviewMessage): void {
		void this.view?.webview.postMessage(message);
	}

	private async buildProjectStatus(): Promise<ChatProjectStatus> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return {
				hasWorkspace: false,
				enabled: false,
				indexing: false,
				ready: false,
			};
		}

		const enabled = await isProjectEnabled(folder.uri.fsPath);
		const progress = getIndexManager()?.getProgress(folder.uri.fsPath);
		return {
			hasWorkspace: true,
			enabled,
			indexing: progress?.state === 'indexing',
			ready: enabled && progress?.state === 'ready',
			error: progress?.lastError,
			fileCount: progress?.fileCount,
			chunkCount: progress?.chunkCount,
		};
	}

	private async postState(): Promise<void> {
		const project = await this.buildProjectStatus();
		this.post({
			type: 'state',
			state: {
				...this.session.getState(),
				project,
			},
		});
	}

	private async onWebviewMessage(msg: FromWebviewMessage): Promise<void> {
		switch (msg.type) {
			case 'ready':
				await this.postState();
				return;
			case 'clear':
				this.session.clear();
				return;
			case 'cancel':
				this.session.cancel();
				return;
			case 'send':
				await this.session.send(msg.text, msg.images);
				return;
			case 'editMessage':
				await this.session.editMessage(msg.id, msg.content);
				return;
			case 'reviewHunk':
				await this.session.reviewHunk(msg.toolCallId, msg.hunkId, msg.action);
				return;
			case 'reviewDiff':
				await this.session.reviewDiff(msg.toolCallId, msg.action);
				return;
			case 'mentionSuggest': {
				const items = await suggestMentions(msg.query);
				this.post({
					type: 'mentionSuggestions',
					requestId: msg.requestId,
					items,
				});
				return;
			}
			case 'setChatMode':
				await this.session.setMode(msg.mode);
				return;
			case 'openSettings':
				SettingsPanel.show(this.context);
				return;
			case 'confirmChoice':
				this.session.resolveConfirm(msg.id, msg.choice);
				return;
			case 'enableProject': {
				const folder = await enableProject();
				if (folder) {
					await getIndexManager()?.enableAndIndex(folder);
				}
				await this.postState();
				return;
			}
			case 'openExternal': {
				try {
					const uri = vscode.Uri.parse(msg.url);
					if (uri.scheme === 'http' || uri.scheme === 'https') {
						await vscode.env.openExternal(uri);
					}
				} catch {}
				return;
			}
			case 'newSession':
				this.session.createSession();
				return;
			case 'switchSession':
				this.session.switchSession(msg.id);
				return;
			case 'renameSession':
				this.session.renameSession(msg.id, msg.title);
				return;
			case 'deleteSession':
				this.session.deleteSession(msg.id);
				return;
			case 'forkSession':
				this.session.forkFromMessage(msg.messageId);
				return;
		}
	}
}
