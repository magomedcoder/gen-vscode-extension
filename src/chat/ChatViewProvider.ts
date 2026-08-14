import * as vscode from 'vscode';
import { getSettings, updateSettings } from '../config/settings';
import { HttpLlmClient } from '../llm/client';
import { createNonce, renderChatHtml } from './chatHtml';
import type { FromWebviewMessage, PanelScreen, ToWebviewMessage } from './protocol';
import { ChatSession } from './ChatSession';

export const CHAT_VIEW_ID = 'gen.chatView';

export class ChatViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private readonly session: ChatSession;
	private readonly client: HttpLlmClient;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.client = new HttpLlmClient();
		this.session = new ChatSession(context, this.client);
		this.session.subscribe((state) => {
			this.post({ type: 'state', state });
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

	showScreen(screen: PanelScreen): void {
		this.post({ type: 'showScreen', screen });
		if (screen === 'settings') {
			this.post({
				type: 'settings',
				settings: getSettings()
			});
		}
	}

	private post(message: ToWebviewMessage): void {
		void this.view?.webview.postMessage(message);
	}

	private async onWebviewMessage(msg: FromWebviewMessage): Promise<void> {
		switch (msg.type) {
			case 'ready':
				this.post({
					type: 'state',
					state: this.session.getState()
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
			case 'loadSettings':
				this.post({
					type: 'settings',
					settings: getSettings(),
				});
				return;
			case 'loadModels':
				try {
					const models = await this.client.listModels({
						baseUrl: msg.baseUrl
					});
					this.post({ type: 'models', models });
				} catch (err) {
					this.post({
						type: 'modelsError',
						message: err instanceof Error ? err.message : String(err),
					});
				}
				return;
			case 'saveSettings':
				try {
					const saved = await updateSettings(msg.settings);
					this.post({
						type: 'settingsSaved',
						settings: saved,
					});
				} catch (err) {
					this.post({
						type: 'settingsError',
						message: err instanceof Error ? err.message : String(err),
					});
				}
				return;
		}
	}
}
