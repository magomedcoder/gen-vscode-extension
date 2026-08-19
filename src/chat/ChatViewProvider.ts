import * as vscode from 'vscode';
import { createNonce, renderChatHtml } from './chatHtml';
import type { FromWebviewMessage, ToWebviewMessage } from './protocol';
import { ChatSession } from './ChatSession';
import { HttpLlmClient } from '../llm/client';
import { onSettingsChanged } from '../config/settings';

export class ChatViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private readonly session: ChatSession;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.session = new ChatSession(context, new HttpLlmClient());
		this.session.subscribe((state) => {
			this.post({ type: 'state', state });
		});
		onSettingsChanged(() => {
			this.post({
				type: 'state',
				state: this.session.getState(),
			});
		});
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;

		const assetsRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [assetsRoot],
		};

		webviewView.webview.html = renderChatHtml({
			cspSource: webviewView.webview.cspSource,
			nonce: createNonce(),
			scriptUri: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.js')),
			styleUri: webviewView.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.css')),
			title: 'Gen Чат',
			screen: 'chat',
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

	private async onWebviewMessage(msg: FromWebviewMessage): Promise<void> {
		switch (msg.type) {
			case 'ready':
				this.post({
					type: 'state',
					state: this.session.getState(),
				});
				return;
			case 'clear':
				this.session.clear();
				return;
			case 'cancel':
				this.session.cancel();
				return;
			case 'send':
				await this.session.send(msg.text);
				return;
			case 'setChatMode':
				await this.session.setMode(msg.mode);
				return;
			case 'openSettings':
				await vscode.commands.executeCommand('gen.openSettings');
				return;
			case 'openExternal': {
				try {
					const uri = vscode.Uri.parse(msg.url);
					if (uri.scheme === 'http' || uri.scheme === 'https') {
						await vscode.env.openExternal(uri);
					}
				} catch {}
				return;
			}
		}
	}
}
