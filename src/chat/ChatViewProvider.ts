import * as vscode from 'vscode';
import { getSettings } from '../config/settings';
import { HttpLlmClient } from '../llm/client';
import type { ChatMessage } from '../llm/types';
import { getEditorChatContext } from './editorContext';
import { getChatHtml } from './getChatHtml';

export const CHAT_VIEW_ID = 'gen.chatView';

const STORAGE_KEY = 'gen.chat.messages';
const MAX_STORED = 40;

const SYSTEM_PROMPT = [
	'Ты Gen - помощник программиста в VS Code.',
	'Отвечай по делу, на языке пользователя.',
	'Если в запросе есть контекст редактора (файл, выделение), опирайся на него.',
].join(' ');

export type ChatRole = 'user' | 'assistant' | 'error';

export interface ChatUiMessage {
	id: string;
	role: ChatRole;
	content: string;
}

interface FromWebview {
	type: 'ready' | 'send' | 'cancel' | 'clear';
	text?: string;
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i += 1) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}

	return nonce;
}

function newMessageId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isAbortError(err: unknown): boolean {
	if (err instanceof Error && (err.name === 'AbortError' || /aborted|abort/i.test(err.message))) {
		return true;
	}

	return false;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private messages: ChatUiMessage[] = [];
	private inflight?: AbortController;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly client = new HttpLlmClient(),
	) {
		this.messages = this.context.workspaceState.get<ChatUiMessage[]>(STORAGE_KEY, []);
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
		};
		webviewView.webview.html = getChatHtml({
			cspSource: webviewView.webview.cspSource,
			nonce: getNonce(),
		});

		webviewView.webview.onDidReceiveMessage((raw: FromWebview) => {
			void this.onMessage(raw);
		});

		webviewView.onDidDispose(() => {
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});
	}

	private post(payload: Record<string, unknown>): void {
		void this.view?.webview.postMessage(payload);
	}

	private persist(): Thenable<void> {
		return this.context.workspaceState.update(STORAGE_KEY, this.messages.slice(-MAX_STORED));
	}

	private pushMessage(msg: ChatUiMessage): void {
		this.messages.push(msg);
		if (this.messages.length > MAX_STORED) {
			this.messages = this.messages.slice(-MAX_STORED);
		}

		this.post({ type: 'message', message: msg });
		void this.persist();
	}

	private async onMessage(msg: FromWebview): Promise<void> {
		if (msg.type === 'ready') {
			this.post({
				type: 'history',
				messages: this.messages,
				busy: Boolean(this.inflight),
			});
			return;
		}

		if (msg.type === 'clear') {
			this.inflight?.abort();
			this.inflight = undefined;
			this.messages = [];
			await this.persist();
			this.post({
				type: 'history',
				messages: [],
				busy: false
			});
			this.post({
				type: 'busy',
				value: false
			});
			return;
		}

		if (msg.type === 'cancel') {
			this.inflight?.abort();
			return;
		}

		if (msg.type === 'send') {
			const text = msg.text?.trim();
			if (!text || this.inflight) {
				return;
			}

			await this.send(text);
		}
	}

	private async send(text: string): Promise<void> {
		this.pushMessage({
			id: newMessageId(),
			role: 'user',
			content: text,
		});

		const settings = getSettings();
		if (!settings.baseUrl.trim() /*|| !settings.model.trim()*/) {
			this.pushMessage({
				id: newMessageId(),
				role: 'error',
				content: 'Не заданы baseUrl или model',
			});
			return;
		}

		const controller = new AbortController();
		this.inflight = controller;
		this.post({ type: 'busy', value: true });

		try {
			const result = await this.client.complete({
				messages: this.buildLlmMessages(text),
				signal: controller.signal,
			});
			this.pushMessage({
				id: newMessageId(),
				role: 'assistant',
				content: result.content.trim(),
			});
		} catch (err) {
			if (isAbortError(err) || controller.signal.aborted) {
				this.pushMessage({
					id: newMessageId(),
					role: 'error',
					content: 'Запрос отменён.',
				});
			} else {
				this.pushMessage({
					id: newMessageId(),
					role: 'error',
					content: err instanceof Error ? err.message : String(err),
				});
			}
		} finally {
			if (this.inflight === controller) {
				this.inflight = undefined;
			}
			this.post({
				type: 'busy',
				value: false
			});
		}
	}

	private buildLlmMessages(latestUserText: string): ChatMessage[] {
		const history: ChatMessage[] = [];
		for (const item of this.messages) {
			if (item.role === 'user' || item.role === 'assistant') {
				history.push({
					role: item.role,
					content: item.content
				});
			}
		}

		const context = getEditorChatContext();
		if (context) {
			const last = history[history.length - 1];
			if (last?.role === 'user' && last.content === latestUserText) {
				last.content = `${latestUserText}\n\n---\nКонтекст редактора:\n${context}`;
			}
		}

		return [
			{
				role: 'system',
				content: SYSTEM_PROMPT
			},
			...history,
		];
	}
}

export function registerChat(context: vscode.ExtensionContext): vscode.Disposable {
	const provider = new ChatViewProvider(context);

	return vscode.Disposable.from(
		vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, provider, {
			webviewOptions: {
				retainContextWhenHidden: true,
			},
		}),
		vscode.commands.registerCommand('gen.openChat', async () => {
			await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
		}),
	);
}
