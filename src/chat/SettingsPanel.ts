import * as vscode from 'vscode';
import { getSettings, hasApiKey, setApiKey, updateSettings } from '../config/settings';
import { HttpLlmClient } from '../llm/client';
import { revealLogsFolder } from '../log/logger';
import { CHAT_VIEW_ID } from './ids';
import { createNonce, renderChatHtml } from './chatHtml';
import type { FromWebviewMessage, ToWebviewMessage } from './protocol';

const VIEW_TYPE = 'gen.settings';

function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === 'AbortError';
}

export class SettingsPanel {
	private static current?: SettingsPanel;
	private modelsAbort?: AbortController;
	private readonly client = new HttpLlmClient();

	static show(context: vscode.ExtensionContext): void {
		if (SettingsPanel.current) {
			SettingsPanel.current.panel.reveal();
			return;
		}

		const assetsRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, vscode.l10n.t('settings.panelTitle'), vscode.ViewColumn.Active, {
			enableScripts: true,
			enableFindWidget: true,
			retainContextWhenHidden: true,
			localResourceRoots: [assetsRoot],
		});
		panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'logo.svg');
		SettingsPanel.current = new SettingsPanel(panel, assetsRoot);
	}

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		assetsRoot: vscode.Uri,
	) {
		this.panel.webview.html = renderChatHtml({
			cspSource: this.panel.webview.cspSource,
			nonce: createNonce(),
			scriptUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.js')),
			styleUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.css')),
			title: 'Настройки Gen',
			screen: 'settings',
		});

		const messageSub = this.panel.webview.onDidReceiveMessage((msg: FromWebviewMessage) => {
			void this.onMessage(msg);
		});

		this.panel.onDidDispose(() => {
			messageSub.dispose();
			this.modelsAbort?.abort();
			if (SettingsPanel.current === this) {
				SettingsPanel.current = undefined;
			}
		});
	}

	private post(message: ToWebviewMessage): void {
		void this.panel.webview.postMessage(message);
	}

	private async postSettings(): Promise<void> {
		this.post({
			type: 'settings',
			settings: getSettings(),
			apiKeySet: await hasApiKey(),
		});
	}

	private async onMessage(msg: FromWebviewMessage): Promise<void> {
		switch (msg.type) {
			case 'ready':
			case 'loadSettings':
				await this.postSettings();
				return;
			case 'closeSettings':
				this.panel.dispose();
				await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
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
			case 'loadModels':
				await this.handleLoadModels(msg.baseUrl, msg.requestId);
				return;
			case 'openLogsFolder':
				await revealLogsFolder();
				return;
			case 'saveSettings':
				try {
					if (typeof msg.apiKey === 'string' && msg.apiKey.trim()) {
						await setApiKey(msg.apiKey);
					}

					const saved = await updateSettings(msg.settings);
					this.post({
						type: 'settingsSaved',
						settings: saved,
						apiKeySet: await hasApiKey(),
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
				models,
				requestId,
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
