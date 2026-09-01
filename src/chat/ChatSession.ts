import * as vscode from 'vscode';
import { AgentSession, isAbortError } from '../agent';
import { AgentCheckpoint, offerCheckpointRestore } from '../agent/checkpoint';
import { StickyPlan } from '../agent/plan';
import { WorkspacePlanStore } from '../agent/planStore';
import type { ConfirmChoice } from '../agent/types';
import { AgentWriteTracker } from '../agent/userEdits';
import { getSettings, isAgentLikeMode, updateSettings } from '../config/settings';
import type { ChatMode } from '../config/types';
import type { LlmClient } from '../llm/types';
import { sumUsage } from '../llm/usage';
import { resolveMentions } from './mentions';
import { buildChatCompletionMessages } from './buildChatCompletionMessages';
import { getEditorChatContext } from './editorContext';
import { CHAT_VIEW_ID } from './ids';
import type { ChatUiMessage, ChatViewState, PendingConfirm } from './protocol';
import type { DiffHunkPayload } from '../agent/diff';
import { revertHunkInText } from '../agent/diff';
import { pathExists, resolveWorkspacePath } from '../agent/workspacePath';
import { getGenRulesManager } from '../project/genrules';

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
	private readonly stickyPlan = new StickyPlan();
	private readonly planStore: WorkspacePlanStore;
	private clearSeq = 0;
	private pendingConfirm?: PendingConfirmInternal;
	private planBootstrapped = false;
	private readonly subs: vscode.Disposable[] = [];

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly client: LlmClient,
	) {
		this.messages = this.context.workspaceState.get<ChatUiMessage[]>(STORAGE_KEY, []);
		this.agent = new AgentSession(client);
		this.planStore = new WorkspacePlanStore(() => {
			void this.onPlanFileExternallyChanged();
		});
		this.planStore.startWatching();
		this.subs.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				void this.bootstrapPlan();
			}),
		);
		void this.bootstrapPlan();
	}

	dispose(): void {
		this.planStore.dispose();
		for (const sub of this.subs) {
			sub.dispose();
		}
		this.subs.length = 0;
	}

	getState(): ChatViewState {
		const settings = getSettings();
		return {
			messages: this.messages,
			busy: Boolean(this.inflight),
			mode: settings.chatMode,
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
		const slim = this.messages.slice(-MAX_STORED).map((msg) => {
			if (!msg.toolCalls?.length) {
				return msg;
			}

			return {
				...msg,
				toolCalls: msg.toolCalls.map((call) => {
					if (!call.hunks?.length) {
						return call;
					}

					return {
						...call,
						hunks: call.hunks.map((hunk) => {
							if (hunk.status === 'pending') {
								return hunk;
							}

							const { oldLines: _o, newLines: _n, beforeContext: _b, afterContext: _a, ...rest } = hunk;
							return {
								...rest,
								oldLines: [],
								newLines: [],
							};
						}),
					};
				}),
			};
		});
		void this.context.workspaceState.update(STORAGE_KEY, slim);
	}

	private onPlanChanged(): void {
		void this.flushPlan();
	}

	private async flushPlan(): Promise<void> {
		if (getSettings().planWriteToFile) {
			await this.planStore.writeSnapshot(this.stickyPlan.snapshot());
		}
		this.emit();
	}

	private async loadPlanFromFile(): Promise<Awaited<ReturnType<WorkspacePlanStore['reload']>>> {
		this.stickyPlan.clear();
		this.planStore.resetCanonical();
		return this.planStore.reload(this.stickyPlan);
	}

	private async bootstrapPlan(): Promise<void> {
		const result = await this.loadPlanFromFile();
		this.planBootstrapped = true;
		this.emit();
		if (result.parseError) {
			void vscode.window.showWarningMessage(vscode.l10n.t('chat.warn.planParse', result.relativePath, result.parseError));
		}
	}

	private async onPlanFileExternallyChanged(): Promise<void> {
		if (!this.planBootstrapped || this.inflight) {
			return;
		}

		const result = await this.planStore.reload(this.stickyPlan);
		this.emit();
		if (result.parseError) {
			void vscode.window.showWarningMessage(vscode.l10n.t('chat.warn.planParse', result.relativePath, result.parseError));
		}
	}

	private async reloadPlanForTurn(): Promise<{ planEditsAppendix?: string; parseError?: string }> {
		// При отключённой записи в файл план живёт в памяти до перезапуска; с диска читаем только если `.gen/plan.md` есть
		if (!getSettings().planWriteToFile) {
			const raw = await this.planStore.readRaw();
			if (!raw?.trim()) {
				return {};
			}
		}

		const result = await this.planStore.reload(this.stickyPlan);
		this.emit();
		if (result.parseError) {
			return { parseError: `${result.relativePath}: ${result.parseError}` };
		}

		if (!result.userDiff) {
			return {};
		}

		return {
			planEditsAppendix: [
				`Пользователь изменил файл плана ${result.relativePath}.`,
				'Актуальный файл - канон: прими эти правки плана, не откатывай их без явной просьбы.',
				result.userDiff,
			].join('\n'),
		};
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

	// Правит сообщение пользователя, отбрасывает всё после него и заново запускает ход
	async editMessage(id: string, content: string): Promise<void> {
		if (this.inflight) {
			return;
		}

		const trimmed = content.trim();
		if (!trimmed) {
			return;
		}

		const idx = this.messages.findIndex((msg) => msg.id === id);
		if (idx < 0) {
			return;
		}

		const msg = this.messages[idx];
		if (msg.role !== 'user' || !msg.content) {
			return;
		}

		this.settleConfirm('abort');
		this.messages = [
			...this.messages.slice(0, idx),
			{
				...msg,
				content: trimmed,
			},
		];
		this.persist();
		this.emit();
		await this.runTurn(trimmed);
	}

	async reviewHunk(toolCallId: string, hunkId: string, action: 'accept' | 'reject'): Promise<void> {
		if (this.inflight) {
			return;
		}

		const found = this.findToolCall(toolCallId);
		if (!found?.call.hunks?.length) {
			return;
		}

		const hunk = found.call.hunks.find((item) => item.id === hunkId);
		if (!hunk || hunk.status !== 'pending') {
			return;
		}

		if (action === 'reject') {
			const ok = await this.applyHunkReject(hunk);
			if (!ok) {
				void vscode.window.showWarningMessage(vscode.l10n.t('chat.hunk.rejectFailed'));
				return;
			}
		}

		hunk.status = action === 'accept' ? 'accepted' : 'rejected';
		this.persist();
		this.emit();
	}

	async reviewDiff(toolCallId: string, action: 'acceptAll' | 'rejectAll'): Promise<void> {
		if (this.inflight) {
			return;
		}

		const found = this.findToolCall(toolCallId);
		if (!found?.call.hunks?.length) {
			return;
		}

		const pending = found.call.hunks.filter((h) => h.status === 'pending');
		if (pending.length === 0) {
			return;
		}

		if (action === 'rejectAll') {
			// С конца: при матче по содержимому раньше откатанные хунки не сдвигают поиск следующих
			for (let i = pending.length - 1; i >= 0; i -= 1) {
				const ok = await this.applyHunkReject(pending[i]);
				if (!ok) {
					void vscode.window.showWarningMessage(vscode.l10n.t('chat.hunk.rejectFailed'));
					this.persist();
					this.emit();
					return;
				}
				pending[i].status = 'rejected';
			}
		} else {
			for (const hunk of pending) {
				hunk.status = 'accepted';
			}
		}

		this.persist();
		this.emit();
	}

	private findToolCall(toolCallId: string): { messageIndex: number; callIndex: number; call: NonNullable<ChatUiMessage['toolCalls']>[number] } | undefined {
		for (let mi = this.messages.length - 1; mi >= 0; mi -= 1) {
			const msg = this.messages[mi];
			if (!msg.toolCalls?.length) {
				continue;
			}

			const callIndex = msg.toolCalls.findIndex((c) => c.id === toolCallId);
			if (callIndex < 0) {
				continue;
			}

			return {
				messageIndex: mi,
				callIndex,
				call: msg.toolCalls[callIndex],
			};
		}

		return undefined;
	}

	private async applyHunkReject(hunk: DiffHunkPayload): Promise<boolean> {
		const relative = hunk.path?.trim();
		if (!relative) {
			return false;
		}

		let resolved;
		try {
			resolved = await resolveWorkspacePath(relative);
		} catch {
			return false;
		}

		const wholeFileAdd = hunk.oldLines.length === 0 && hunk.newLines.length > 0 && hunk.beforeContext === undefined && hunk.afterContext === undefined;

		if (wholeFileAdd && !(await pathExists(resolved.uri))) {
			return true;
		}

		if (wholeFileAdd && (await pathExists(resolved.uri))) {
			try {
				const doc = await vscode.workspace.openTextDocument(resolved.uri);
				const text = doc.getText();
				const newText = hunk.newLines.join('\n');
				if (text === newText || text.replace(/\n$/, '') === newText.replace(/\n$/, '')) {
					await vscode.workspace.fs.delete(resolved.uri, { useTrash: true });
					this.writes.forget(resolved.uri);
					return true;
				}
			} catch {
				return false;
			}
		}

		if (!(await pathExists(resolved.uri))) {
			return false;
		}

		const doc = await vscode.workspace.openTextDocument(resolved.uri);
		const next = revertHunkInText(doc.getText(), hunk);
		if (next === undefined) {
			return false;
		}

		const last = Math.max(0, doc.lineCount - 1);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, new vscode.Range(0, 0, last, doc.lineAt(last).text.length), next);
		const ok = await vscode.workspace.applyEdit(edit);
		if (!ok) {
			return false;
		}

		this.writes.remember(doc.uri, resolved.relative, next);
		return true;
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
		await this.runTurn(trimmed);
	}

	// Запуск хода: последнее сообщение уже user с этим текстом
	private async runTurn(trimmed: string): Promise<void> {
		if (this.inflight) {
			return;
		}

		const clearSeqAtStart = this.clearSeq;
		const settings = getSettings();
		if (!settings.baseUrl.trim() || !settings.model.trim()) {
			this.append({
				id: messageId(),
				role: 'error',
				content: vscode.l10n.t('chat.error.missingUrlOrModel'),
			});
			return;
		}

		const controller = new AbortController();
		this.inflight = controller;
		this.emit();

		const historyBeforeUser = this.messages.slice(0, -1);
		const checkpoint = new AgentCheckpoint();
		const mentions = await resolveMentions(trimmed);
		const editorCtx = getEditorChatContext();
		const mergedContext = [editorCtx, mentions.contextText].filter(Boolean).join('\n\n') || undefined;
		const llmUserText = mentions.mentions.length > 0 ? (mentions.cleanText || trimmed) : trimmed;

		try {
			if (isAgentLikeMode(settings.chatMode)) {
				const planReload = await this.reloadPlanForTurn();
				if (planReload.parseError) {
					this.append({
						id: messageId(),
						role: 'error',
						content: vscode.l10n.t('chat.error.planParse', planReload.parseError, this.planStore.relativePath),
					});
				}
				await this.agent.run({
					history: historyBeforeUser,
					userText: llmUserText,
					editorContext: mergedContext,
					signal: controller.signal,
					confirm: (req) => this.requestConfirm(req),
					revealFile: revealAgentFile,
					plan: this.stickyPlan,
					onPlanChanged: () => this.onPlanChanged(),
					checkpoint,
					writes: this.writes,
					planEditsAppendix: planReload.planEditsAppendix,
					mode: settings.chatMode,
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
						llmUserText,
						mergedContext,
						getGenRulesManager()?.getPromptAppendix(),
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
				content: cancelled ? vscode.l10n.t('chat.error.cancelled') : err instanceof Error ? err.message : String(err),
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
