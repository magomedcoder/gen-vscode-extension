import type { ExtensionContext } from 'vscode';
import { AgentSession, isAbortError } from '../agent';
import { getSettings, updateSettings } from '../config/settings';
import type { ChatMode } from '../config/types';
import type { LlmClient } from '../llm/types';
import { buildChatCompletionMessages } from './buildChatCompletionMessages';
import { getEditorChatContext } from './editorContext';
import type { ChatUiMessage, ChatViewState } from './protocol';

const STORAGE_KEY = 'gen.chat.messages';
const MAX_STORED = 80;

function messageId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type ChatSessionListener = (state: ChatViewState) => void;

export class ChatSession {
	private messages: ChatUiMessage[];
	private inflight?: AbortController;
	private readonly listeners = new Set<ChatSessionListener>();
	private readonly agent: AgentSession;

	constructor(
		private readonly context: ExtensionContext,
		private readonly client: LlmClient,
	) {
		this.messages = this.context.workspaceState.get<ChatUiMessage[]>(STORAGE_KEY, []);
		this.agent = new AgentSession(client);
	}

	getState(): ChatViewState {
		return {
			messages: this.messages,
			busy: Boolean(this.inflight),
			mode: getSettings().chatMode,
		};
	}

	subscribe(listener: ChatSessionListener): { dispose(): void } {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	}

	private emit(): void {
		const state = this.getState();
		for (const listener of this.listeners) {
			listener(state);
		}
	}

	private persist(): void {
		void this.context.workspaceState.update(STORAGE_KEY, this.messages.slice(-MAX_STORED));
	}

	private append(message: ChatUiMessage): void {
		this.messages = [...this.messages, message].slice(-MAX_STORED);
		this.persist();
		this.emit();
	}

	private update(id: string, patch: Partial<ChatUiMessage>): void {
		this.messages = this.messages.map((msg) => (msg.id === id ? {
			...msg,
			...patch
		} : msg));
		this.persist();
		this.emit();
	}

	clear(): void {
		this.inflight?.abort();
		this.inflight = undefined;
		this.messages = [];
		this.persist();
		this.emit();
	}

	cancel(): void {
		this.inflight?.abort();
	}

	async setMode(mode: ChatMode): Promise<void> {
		await updateSettings({
			...getSettings(),
			chatMode: mode
		});
		this.emit();
	}

	async send(text: string): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed || this.inflight) {
			return;
		}

		this.append({
			id: messageId(),
			role: 'user',
			content: trimmed,
		});

		const settings = getSettings();
		if (!settings.baseUrl.trim() || !settings.model.trim()) {
			this.append({
				id: messageId(),
				role: 'error',
				content: 'Не заданы базовый URL или модель',
			});
			return;
		}

		const controller = new AbortController();
		this.inflight = controller;
		this.emit();

		const historyBeforeUser = this.messages.slice(0, -1);

		try {
			if (settings.chatMode === 'agent') {
				await this.agent.run({
					history: historyBeforeUser,
					userText: trimmed,
					editorContext: getEditorChatContext(),
					signal: controller.signal,
					ui: {
						append: (message) => this.append(message),
						update: (id, patch) => this.update(id, patch),
					},
				});
			} else {
				const result = await this.client.complete({
					messages: buildChatCompletionMessages(
						this.messages,
						trimmed,
						getEditorChatContext(),
					),
					signal: controller.signal,
				});

				this.append({
					id: messageId(),
					role: 'assistant',
					content: result.content.trim(),
				});
			}
		} catch (err) {
			const cancelled = isAbortError(err) || controller.signal.aborted;
			this.append({
				id: messageId(),
				role: 'error',
				content: cancelled ? 'Запрос отменён.' : err instanceof Error ? err.message : String(err),
			});
		} finally {
			if (this.inflight === controller) {
				this.inflight = undefined;
			}
			this.emit();
		}
	}
}
