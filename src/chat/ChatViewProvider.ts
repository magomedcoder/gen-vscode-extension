import * as vscode from 'vscode';
import { getSettings, updateSettings } from '../config/settings';
import { HttpLlmClient } from '../llm/client';
import { createNonce, renderChatHtml } from './chatHtml';
import type { FromWebviewMessage, PanelScreen, ToWebviewMessage } from './protocol';
import { ChatSession } from './ChatSession';

export const CHAT_VIEW_ID = 'gen.chatView';

function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === 'AbortError';
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private readonly session: ChatSession;
	private readonly client: HttpLlmClient;
	private modelsAbort?: AbortController;

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
			this.modelsAbort?.abort();
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});
	}


	showScreen(screen: PanelScreen): void {
		this.post({ type: 'showScreen', screen });
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
			case 'openExternal': {
				try {
					const uri = vscode.Uri.parse(msg.url);
					if (uri.scheme === 'http' || uri.scheme === 'https') {
						await vscode.env.openExternal(uri);
					}
				} catch {}
				return;
			}
			case 'loadSettings':
				this.post({
					type: 'settings',
					settings: getSettings()
				});
				return;
			case 'loadModels':
				await this.handleLoadModels(msg.baseUrl, msg.requestId);
				return;
			case 'saveSettings':
				try {
					const saved = await updateSettings(msg.settings);
					this.post({
						type: 'settingsSaved',
						settings: saved
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

	private async handleLoadModels(baseUrl: string, requestId: number): Promise<void> {
		this.modelsAbort?.abort();
		const controller = new AbortController();
		this.modelsAbort = controller;

		try {
			const models = await this.client.listModels({
				baseUrl,
				signal: controller.signal,
			});
			if (controller.signal.aborted) {
				return;
			}
			this.post({
				type: 'models',
				models, requestId
			});
		} catch (err) {
			if (isAbortError(err) || controller.signal.aborted) {
				return;
			}
			this.post({
				type: 'modelsError',
				message: err instanceof Error ? err.message : String(err),
				requestId,
			});
		} finally {
			if (this.modelsAbort === controller) {
				this.modelsAbort = undefined;
			}
		}
	}
}
