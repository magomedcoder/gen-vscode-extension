import * as vscode from 'vscode';
import { AgentSession, isAbortError } from '../agent';
import { AgentCheckpoint, offerCheckpointRestore } from '../agent/checkpoint';
import { TurnPlan } from '../agent/plan';
import type { ConfirmChoice } from '../agent/types';
import { AgentWriteTracker } from '../agent/userEdits';
import { getSettings, updateSettings } from '../config/settings';
import type { ChatMode } from '../config/types';
import type { LlmClient } from '../llm/types';
import { sumUsage } from '../llm/usage';
import { buildChatCompletionMessages } from './buildChatCompletionMessages';
import { getEditorChatContext } from './editorContext';
import { CHAT_VIEW_ID } from './ids';
import type { ChatUiMessage, ChatViewState, PendingConfirm } from './protocol';

const STORAGE_KEY = 'gen.chat.messages';
const MAX_STORED = 80;

function messageId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function revealAgentFile(uri: vscode.Uri): Promise<void> {
	await vscode.window.showTextDocument(uri, { preview: true });
}

type ChatSessionListener = (state: ChatViewState) => void;

interface PendingConfirmInternal extends PendingConfirm {
	resolve: (choice: ConfirmChoice) => void;
}

export class ChatSession {
	private messages: ChatUiMessage[];
	private inflight?: AbortController;
	private readonly listeners = new Set<ChatSessionListener>();
	private readonly agent: AgentSession;
	private readonly writes = new AgentWriteTracker();
	private clearSeq = 0;
	private pendingConfirm?: PendingConfirmInternal;

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
			pendingConfirm: this.pendingConfirm
				? {
					id: this.pendingConfirm.id,
					title: this.pendingConfirm.title,
					detail: this.pendingConfirm.detail,
					hint: this.pendingConfirm.hint,
					variant: this.pendingConfirm.variant,
					applyLabel: this.pendingConfirm.applyLabel,
					skipLabel: this.pendingConfirm.skipLabel,
					stopLabel: this.pendingConfirm.stopLabel,
					rejectLabel: this.pendingConfirm.rejectLabel,
				}
				: undefined,
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

	private settleConfirm(choice: ConfirmChoice): void {
		const pending = this.pendingConfirm;
		if (!pending) {
			return;
		}
		this.pendingConfirm = undefined;
		this.emit();
		pending.resolve(choice);
	}

	resolveConfirm(id: string, choice: ConfirmChoice): void {
		if (!this.pendingConfirm || this.pendingConfirm.id !== id) {
			return;
		}
		this.settleConfirm(choice);
	}

	async requestConfirm(request: {
		title: string;
		detail?: string;
		hint?: string;
		variant?: PendingConfirm['variant'];
		applyLabel?: string;
		rejectLabel?: string;
	}): Promise<ConfirmChoice> {
		if (this.pendingConfirm) {
			this.settleConfirm('abort');
		}

		void vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);

		const variant = request.variant ?? 'agent';
		return new Promise<ConfirmChoice>((resolve) => {
			this.pendingConfirm = {
				id: messageId(),
				title: request.title,
				detail: request.detail,
				hint: request.hint,
				variant,
				applyLabel: request.applyLabel ?? vscode.l10n.t('agent.confirmApply'),
				skipLabel: vscode.l10n.t('agent.confirmSkip'),
				stopLabel: vscode.l10n.t('agent.confirmStop'),
				rejectLabel: request.rejectLabel ?? vscode.l10n.t('comment.reject'),
				resolve,
			};
			this.emit();
		});
	}

	clear(): void {
		this.clearSeq += 1;
		this.inflight?.abort();
		this.inflight = undefined;
		this.settleConfirm('abort');
		this.writes.clear();
		this.messages = [];
		this.persist();
		this.emit();
	}

	cancel(): void {
		this.inflight?.abort();
		this.settleConfirm('abort');
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
					confirm: (req) => this.requestConfirm(req),
					revealFile: revealAgentFile,
					plan,
					checkpoint,
					writes: this.writes,
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
			const restored = await offerCheckpointRestore(checkpoint);
			if (restored.length > 0) {
				this.writes.clear();
			}
		}
	}
}
