import * as vscode from 'vscode';
import { AgentSession, isAbortError } from '../agent';
import { AgentCheckpoint, offerCheckpointRestore } from '../agent/checkpoint';
import { TurnPlan } from '../agent/plan';
import type { ConfirmChoice } from '../agent/types';
import { getSettings, updateSettings } from '../config/settings';
import type { ChatMode } from '../config/types';
import type { LlmClient } from '../llm/types';
import { buildChatCompletionMessages } from './buildChatCompletionMessages';
import { getEditorChatContext } from './editorContext';
import type { ChatUiMessage, ChatViewState } from './protocol';
import { sumUsage } from '../llm/usage';

const STORAGE_KEY = 'gen.chat.messages';
const MAX_STORED = 80;

function messageId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function confirmAgentAction(request: { title: string; detail?: string }): Promise<ConfirmChoice> {
	const apply = vscode.l10n.t('agent.confirmApply');
	const skip = vscode.l10n.t('agent.confirmSkip');
	const stop = vscode.l10n.t('agent.confirmStop');
	const choice = await vscode.window.showWarningMessage(
		request.title,
		{ modal: true, detail: request.detail },
		apply,
		skip,
		stop,
	);

	if (choice === apply) {
		return 'apply';
	}

	if (choice === skip) {
		return 'skip';
	}
	
	return 'abort';
}

async function revealAgentFile(uri: vscode.Uri): Promise<void> {
	await vscode.window.showTextDocument(uri, { preview: true });
}

type ChatSessionListener = (state: ChatViewState) => void;

export class ChatSession {
	private messages: ChatUiMessage[];
	private inflight?: AbortController;
	private readonly listeners = new Set<ChatSessionListener>();
	private readonly agent: AgentSession;
	private clearSeq = 0;

	constructor(
		private readonly context: vscode.ExtensionContext,
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
			usage: sumUsage(this.messages),
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
		if (patch.toolCalls || patch.usage) {
			this.persist();
		}

		this.emit();
	}

	clear(): void {
		// Версия очистки нужна, чтобы незавершенный send() после отмены не дописал сообщения обратно в историю и не перезаписал storage
		this.clearSeq += 1;
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

		const clearSeqAtStart = this.clearSeq;

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
		const plan = new TurnPlan();
		const checkpoint = new AgentCheckpoint();

		try {
			if (settings.chatMode === 'agent') {
				await this.agent.run({
					history: historyBeforeUser,
					userText: trimmed,
					editorContext: getEditorChatContext(),
					signal: controller.signal,
					confirm: confirmAgentAction,
					revealFile: revealAgentFile,
					plan,
					checkpoint,
					ui: {
						append: (message) => {
							if (this.clearSeq !== clearSeqAtStart) {
								return;
							}
							this.append(message);
						},
						update: (id, patch) => {
							if (this.clearSeq !== clearSeqAtStart) {
								return;
							}
							this.update(id, patch);
						},
					},
				});
			} else {
				const historyForAsk = this.messages;
				const assistantId = messageId();
				let streamed = '';
				this.append({
					id: assistantId,
					role: 'assistant',
					content: '',
				});
				const result = await this.client.complete({
					messages: buildChatCompletionMessages(
						historyForAsk,
						trimmed,
						getEditorChatContext(),
					),
					signal: controller.signal,
					onDelta: (chunk) => {
						if (this.clearSeq !== clearSeqAtStart) {
							return;
						}
						streamed += chunk;
						this.update(assistantId, {
							content: streamed
						});
					},
				});
				if (this.clearSeq === clearSeqAtStart) {
					this.update(assistantId, {
						content: result.content.trim() || streamed,
						usage: result.usage,
					});
				}
			}
		} catch (err) {
			if (this.clearSeq !== clearSeqAtStart) {
				return;
			}
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
			if (this.clearSeq === clearSeqAtStart) {
				this.persist();
				this.emit();
			}
		}

		if (this.clearSeq !== clearSeqAtStart) {
			return;
		}

		if (checkpoint.size > 0) {
			await offerCheckpointRestore(checkpoint);
		}
	}
}
