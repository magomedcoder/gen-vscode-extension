import * as vscode from 'vscode';
import { AgentSession, isAbortError } from '../agent';
import { AgentCheckpoint, offerCheckpointRestore } from '../agent/checkpoint';
import { StickyPlan } from '../agent/plan';
import { WorkspacePlanStore } from '../agent/planStore';
import type { ConfirmChoice } from '../agent/types';
import { AgentWriteTracker } from '../agent/userEdits';
import { getSettings, isAgentLikeMode, setSessionModel, updateSettings } from '../config/settings';
import type { ChatMode } from '../config/types';
import { writeLog } from '../log/logger';
import type { LlmClient } from '../llm/types';
import { sumUsage } from '../llm/usage';
import { resolveBangCommands } from './bangCommand';
import { compactChatMessages } from './compact';
import { resolveMentions } from './mentions';
import { buildChatCompletionMessages } from './buildChatCompletionMessages';
import { injectImagePathMarkers, saveImageAttachments } from './attachments';
import type { ImageAttachment, IncomingImage } from './attachments';
import { getEditorChatContext } from './editorContext';
import { CHAT_VIEW_ID } from './ids';
import type { ChatUiMessage, ChatViewState, PendingConfirm } from './protocol';
import { SessionStore, fallbackTitleFromMessages, isDefaultSessionTitle } from './sessionStore';
import { generateSessionTitle } from '../agent/systemAgents';
import { loadProjectRulesAppendix } from '../project/projectRules';
import { parseSlashMode, type SlashCommand } from './slashCommands';
import { getAlwaysOnWorkspaceContext } from './workspaceContext';
import type { DiffHunkPayload } from '../agent/diff';
import { revertHunkInText } from '../agent/diff';
import { pathExists, resolveWorkspacePath } from '../agent/workspacePath';
import { customToSlashCommand, discoverCustomCommands, expandCommandTemplate } from '../project/customCommands';
import type { CustomCommand } from '../project/customCommands';
import { getGenRulesManager } from '../project/genrules';
import { formatPersonaAppendix, resolvePersona } from '../project/personas';
import { runBeforeSubmitHook } from '../project/hooks';

const MAX_STORED = 80;
// Максимум сообщений в очереди, пока занят текущий turn
const MAX_TURN_QUEUE = 8;
// Стек undo/redo последних user turns
const MAX_TURN_HISTORY = 12;

function messageId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneMessages(messages: ChatUiMessage[]): ChatUiMessage[] {
	return messages.map((m) => ({ 
		...m, 
		toolCalls: m.toolCalls?.map((tc) => ({ ...tc })) 
	}));
}

interface TurnHistoryEntry {
	messages: ChatUiMessage[];
	checkpoint?: AgentCheckpoint;
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
	// Текст статуса при HTTP-retry (показывается в UI пока busy)
	private busyDetail?: string;
	private readonly listeners = new Set<ChatSessionListener>();
	private readonly agent: AgentSession;
	private readonly writes = new AgentWriteTracker();
	private readonly stickyPlan = new StickyPlan();
	private readonly planStore: WorkspacePlanStore;
	private clearSeq = 0;
	private pendingConfirm?: PendingConfirmInternal;
	private planBootstrapped = false;
	private readonly turnQueue: Array<{ 
		text: string
		attachments?: ImageAttachment[] 
	}> = [];
	private readonly sessionAllow: string[] = [];
	private readonly subs: vscode.Disposable[] = [];
	private customCommands: CustomCommand[] = [];
	private lastCheckpoint?: AgentCheckpoint;
	private readonly undoStack: TurnHistoryEntry[] = [];
	private readonly redoStack: TurnHistoryEntry[] = [];
	private readonly sessions: SessionStore;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly client: LlmClient,
	) {
		this.sessions = new SessionStore(this.context.workspaceState);
		this.messages = [...this.sessions.getCurrent().messages];
		this.agent = new AgentSession(client);
		this.planStore = new WorkspacePlanStore(() => {
			void this.onPlanFileExternallyChanged();
		});
		this.planStore.startWatching();
		this.subs.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				void this.bootstrapPlan();
				void this.refreshCustomCommands();
			}),
		);
		void this.bootstrapPlan();
		void this.refreshCustomCommands();
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
		const customSlashCommands: SlashCommand[] = this.customCommands.map(customToSlashCommand);
		return {
			messages: this.messages,
			busy: Boolean(this.inflight),
			busyDetail: this.busyDetail,
			queuedCount: this.turnQueue.length,
			mode: settings.chatMode,
			usage: sumUsage(this.messages),
			maxContextTokens: settings.maxContextTokens,
			sessionId: this.sessions.getCurrentSessionId(),
			sessions: this.sessions.listSessions(),
			customSlashCommands,
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
					alwaysLabel: this.pendingConfirm.alwaysLabel,
					suggestion: this.pendingConfirm.suggestion,
					allowAlways: this.pendingConfirm.allowAlways,
				}
				: undefined,
		};
	}

	private async refreshCustomCommands(): Promise<void> {
		try {
			this.customCommands = await discoverCustomCommands();
			this.emit();
		} catch {
			this.customCommands = [];
		}
	}

	private customSlashExtra(): SlashCommand[] {
		return this.customCommands.map(customToSlashCommand);
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
		this.sessions.saveMessages(this.messages.slice(-MAX_STORED));
	}

	private resetTurnStateForSessionSwitch(): void {
		this.clearSeq += 1;
		this.turnQueue.length = 0;
		this.inflight?.abort();
		this.inflight = undefined;
		this.busyDetail = undefined;
		this.settleConfirm('abort');
		this.writes.clear();
		this.sessionAllow.length = 0;
		this.lastCheckpoint = undefined;
		this.undoStack.length = 0;
		this.redoStack.length = 0;
	}

	listSessions() {
		return this.sessions.listSessions();
	}

	createSession(): void {
		this.persist();
		this.resetTurnStateForSessionSwitch();
		const created = this.sessions.createSession();
		this.messages = [...created.messages];
		this.emit();
	}

	switchSession(id: string): void {
		if (id === this.sessions.getCurrentSessionId()) {
			return;
		}

		this.persist();
		this.resetTurnStateForSessionSwitch();
		const next = this.sessions.switchSession(id);
		if (!next) {
			return;
		}

		this.messages = [...next.messages];
		this.emit();
	}

	renameSession(id: string, title: string): void {
		if (!this.sessions.renameSession(id, title)) {
			return;
		}

		this.emit();
	}

	deleteSession(id: string): void {
		const wasCurrent = id === this.sessions.getCurrentSessionId();
		if (wasCurrent) {
			this.resetTurnStateForSessionSwitch();
		}

		if (!this.sessions.deleteSession(id)) {
			return;
		}

		if (wasCurrent) {
			this.messages = [...this.sessions.getCurrent().messages];
		}

		this.emit();
	}

	forkFromMessage(messageId: string): void {
		this.persist();
		this.resetTurnStateForSessionSwitch();
		const forked = this.sessions.forkFromMessage(this.sessions.getCurrentSessionId(), messageId);
		if (!forked) {
			void vscode.window.showWarningMessage(vscode.l10n.t('chat.session.forkFailed'));
			return;
		}

		this.messages = [...forked.messages];
		this.emit();
	}

	async compactSession(): Promise<void> {
		await this.runCompact();
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
		suggestion?: string;
		allowAlways?: boolean;
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
				alwaysLabel: vscode.l10n.t('agent.confirmAlways'),
				suggestion: request.suggestion,
				allowAlways: request.allowAlways,
				resolve,
			};
			this.emit();
		});
	}

	clear(): void {
		this.clearSeq += 1;
		this.turnQueue.length = 0;
		this.inflight?.abort();
		this.inflight = undefined;
		this.busyDetail = undefined;
		this.settleConfirm('abort');
		this.writes.clear();
		this.lastCheckpoint = undefined;
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this.messages = [];
		this.persist();
		this.emit();
	}

	// Стоп: прервать текущий turn и сбросить очередь ожидающих сообщений
	cancel(): void {
		this.turnQueue.length = 0;
		this.inflight?.abort();
		this.settleConfirm('abort');
		this.emit();
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

	async send(text: string, images?: IncomingImage[]): Promise<void> {
		const trimmed = text.trim();
		const hasImages = Boolean(images?.length);
		if (!trimmed && !hasImages) {
			return;
		}

		let attachments: ImageAttachment[] | undefined;
		let payload = trimmed;
		if (hasImages) {
			try {
				attachments = await saveImageAttachments(images!);
				payload = injectImagePathMarkers(trimmed, attachments);
			} catch (err) {
				this.append({
					id: messageId(),
					role: 'error',
					content: vscode.l10n.t(
						'chat.error.attachImage',
						err instanceof Error ? err.message : String(err),
					),
				});
				return;
			}
		}

		await this.refreshCustomCommands();
		const extra = this.customSlashExtra();
		const slash = parseSlashMode(payload, extra);
		if (slash) {
			if (slash.command === 'export') {
				await this.exportSessionMarkdown();
				return;
			}

			if (slash.command === 'init') {
				await this.runInitRules(slash.rest);
				return;
			}

			if (slash.command === 'new') {
				this.createSession();
				this.append({
					id: messageId(),
					role: 'assistant',
					content: vscode.l10n.t('chat.slash.new.done'),
				});
				return;
			}

			if (slash.command === 'compact') {
				await this.runCompact();
				return;
			}

			if (slash.command === 'undo') {
				await this.runUndo();
				return;
			}

			if (slash.command === 'redo') {
				await this.runRedo();
				return;
			}

			if (slash.command === 'sessions') {
				const list = this.sessions.listSessions();
				const lines = list.map((s, i) => {
					const mark = s.id === this.sessions.getCurrentSessionId() ? ' ' : ' ';
					return `${mark} ${i + 1}. ${s.title} (${s.messageCount})`;
				});
				this.append({
					id: messageId(),
					role: 'assistant',
					content: vscode.l10n.t('chat.slash.sessions.info', list.length, lines.join('\n') || '-'),
				});
				return;
			}

			if (slash.command === 'models') {
				const settings = getSettings();
				const model = settings.model.trim() || '-';
				const small = settings.smallModel.trim() || '-';
				this.append({
					id: messageId(),
					role: 'assistant',
					content: vscode.l10n.t('chat.slash.models.info', model, small),
				});
				return;
			}

			if (slash.custom) {
				const custom = this.customCommands.find((c) => c.name === slash.command);
				if (!custom) {
					return;
				}

				if (custom.mode && custom.mode !== getSettings().chatMode) {
					await this.setMode(custom.mode);
				}

				if (custom.model?.trim()) {
					setSessionModel(custom.model.trim());
				}

				const expanded = expandCommandTemplate(custom.body, slash.rest);
				if (!expanded) {
					this.append({
						id: messageId(),
						role: 'assistant',
						content: vscode.l10n.t('chat.slash.custom.empty', custom.name),
					});
					return;
				}

				await this.send(expanded);
				return;
			}

			if (slash.mode && slash.mode !== getSettings().chatMode) {
				await this.setMode(slash.mode);
			}

			if (!slash.rest) {
				return;
			}

			await this.send(slash.rest);
			return;
		}

		const hook = await runBeforeSubmitHook(payload);
		if (hook.vetoed) {
			this.append({
				id: messageId(),
				role: 'error',
				content: hook.stderr?.trim() || vscode.l10n.t('chat.hooks.veto', 'beforeSubmit', hook.command ?? ''),
			});
			return;
		}

		if (this.inflight) {
			if (this.turnQueue.length >= MAX_TURN_QUEUE) {
				this.append({
					id: messageId(),
					role: 'error',
					content: vscode.l10n.t('chat.error.queueFull', MAX_TURN_QUEUE),
				});
				return;
			}

			this.turnQueue.push({ text: payload, attachments });
			this.emit();
			return;
		}

		this.append({
			id: messageId(),
			role: 'user',
			content: payload,
			attachments,
		});
		await this.runTurn(payload, attachments);
	}

	private async runCompact(): Promise<void> {
		if (this.inflight) {
			this.append({
				id: messageId(),
				role: 'error',
				content: vscode.l10n.t('chat.compact.busy'),
			});
			return;
		}

		if (!(await this.ensureSessionModel())) {
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
		try {
			const result = await compactChatMessages(this.messages, this.client, {
				signal: controller.signal,
			});
			if (!result.compacted) {
				this.append({
					id: messageId(),
					role: 'assistant',
					content: result.reason ?? vscode.l10n.t('chat.compact.nothingToDo', 4),
				});
				return;
			}

			this.messages = result.messages;
			this.persist();
			this.append({
				id: messageId(),
				role: 'assistant',
				content: vscode.l10n.t('chat.compact.done'),
			});
		} catch (err) {
			const cancelled = isAbortError(err) || controller.signal.aborted;
			this.append({
				id: messageId(),
				role: 'error',
				content: cancelled
					? vscode.l10n.t('chat.error.cancelled')
					: err instanceof Error ? err.message : String(err),
			});
		} finally {
			if (this.inflight === controller) {
				this.inflight = undefined;
			}
			this.emit();
		}
	}

	private async runUndo(): Promise<void> {
		if (this.inflight) {
			return;
		}

		const entry = this.undoStack.pop();
		if (!entry) {
			// Fallback: старое поведение без стека (один lastCheckpoint)
			if (this.lastCheckpoint && this.lastCheckpoint.size > 0) {
				const restored = await this.lastCheckpoint.restore();
				this.lastCheckpoint = undefined;
				this.writes.clear();
				const trimmed = this.trimLastUserTurn();
				this.append({
					id: messageId(),
					role: 'assistant',
					content: restored.length > 0
						? vscode.l10n.t('chat.slash.undo.restored', restored.length)
						: trimmed
							? vscode.l10n.t('chat.slash.undo.trimmed')
							: vscode.l10n.t('chat.slash.undo.empty'),
				});
				return;
			}

			const trimmed = this.trimLastUserTurn();
			this.append({
				id: messageId(),
				role: 'assistant',
				content: trimmed
					? vscode.l10n.t('chat.slash.undo.trimmed')
					: vscode.l10n.t('chat.slash.undo.empty'),
			});
			return;
		}

		this.redoStack.push({
			messages: cloneMessages(this.messages),
			checkpoint: this.lastCheckpoint,
		});
		if (this.redoStack.length > MAX_TURN_HISTORY) {
			this.redoStack.shift();
		}

		let restoredFiles = 0;
		if (entry.checkpoint && entry.checkpoint.size > 0) {
			const paths = await entry.checkpoint.restore();
			restoredFiles = paths.length;
			this.writes.clear();
		}

		this.messages = cloneMessages(entry.messages);
		this.lastCheckpoint = undefined;
		this.persist();
		this.emit();
		this.append({
			id: messageId(),
			role: 'assistant',
			content: restoredFiles > 0
				? vscode.l10n.t('chat.slash.undo.restored', restoredFiles)
				: vscode.l10n.t('chat.slash.undo.trimmed'),
		});
	}

	private async runRedo(): Promise<void> {
		if (this.inflight) {
			return;
		}

		const entry = this.redoStack.pop();
		if (!entry) {
			this.append({
				id: messageId(),
				role: 'assistant',
				content: vscode.l10n.t('chat.slash.redo.empty'),
			});
			return;
		}

		this.undoStack.push({
			messages: cloneMessages(this.messages),
			checkpoint: this.lastCheckpoint,
		});
		if (this.undoStack.length > MAX_TURN_HISTORY) {
			this.undoStack.shift();
		}

		this.messages = cloneMessages(entry.messages);
		this.lastCheckpoint = entry.checkpoint;
		this.persist();
		this.emit();
		this.append({
			id: messageId(),
			role: 'assistant',
			content: vscode.l10n.t('chat.slash.redo.done'),
		});
	}

	// Удалить последний ход пользователя и всё после него
	private trimLastUserTurn(): boolean {
		let lastUser = -1;
		for (let i = this.messages.length - 1; i >= 0; i -= 1) {
			if (this.messages[i]!.role === 'user') {
				lastUser = i;
				break;
			}
		}

		if (lastUser < 0) {
			return false;
		}

		this.messages = this.messages.slice(0, lastUser);
		this.persist();
		this.emit();
		return true;
	}

	private async ensureSessionModel(): Promise<boolean> {
		const settings = getSettings();
		if (settings.model.trim()) {
			return true;
		}

		try {
			const models = await this.client.listModels({ 
				baseUrl: settings.baseUrl 
			});
			if (models.length === 0) {
				return false;
			}

			setSessionModel(models[0]);
			return true;
		} catch {
			return false;
		}
	}

	// После завершения turn - взять следующее из очереди
	private async drainTurnQueue(): Promise<void> {
		if (this.inflight) {
			return;
		}

		const next = this.turnQueue.shift();
		if (!next) {
			this.emit();
			return;
		}

		this.emit();
		this.append({
			id: messageId(),
			role: 'user',
			content: next.text,
			attachments: next.attachments,
		});
		await this.runTurn(next.text, next.attachments);
	}

	// Запуск хода: последнее сообщение уже user с этим текстом
	private async runTurn(trimmed: string, attachments?: readonly ImageAttachment[]): Promise<void> {
		if (this.inflight) {
			return;
		}

		const clearSeqAtStart = this.clearSeq;
		const settings = getSettings();
		if (!settings.baseUrl.trim()) {
			this.append({
				id: messageId(),
				role: 'error',
				content: vscode.l10n.t('chat.error.missingUrlOrModel'),
			});
			return;
		}

		if (!(await this.ensureSessionModel())) {
			this.append({
				id: messageId(),
				role: 'error',
				content: vscode.l10n.t('chat.error.missingUrlOrModel'),
			});
			return;
		}

		const controller = new AbortController();
		this.inflight = controller;
		this.busyDetail = undefined;
		this.emit();

		const historyBeforeUser = this.messages.slice(0, -1);
		const checkpoint = new AgentCheckpoint();
		// Стек undo: снимок сообщений до хода; checkpoint допишем в конце
		this.undoStack.push({
			messages: cloneMessages(historyBeforeUser),
			checkpoint: undefined,
		});
		if (this.undoStack.length > MAX_TURN_HISTORY) {
			this.undoStack.shift();
		}
		this.redoStack.length = 0;
		const mentions = await resolveMentions(trimmed);
		const bangs = await resolveBangCommands(mentions.cleanText || trimmed, controller.signal);
		const editorCtx = getEditorChatContext();
		const alwaysOn = await getAlwaysOnWorkspaceContext();
		const mergedContext = [editorCtx, alwaysOn, mentions.contextText, bangs.contextText].filter(Boolean).join('\n\n') || undefined;
		const llmUserText = bangs.cleanText || mentions.cleanText || trimmed;
		let turnOk = false;

		const onRetry = (info: { attempt: number; maxAttempts: number; status?: number; delayMs: number }) => {
			this.busyDetail = vscode.l10n.t(
				'chat.retrying',
				info.attempt,
				info.maxAttempts,
				info.status ?? '-',
			);
			this.emit();
		};

		const clearRetryStatus = () => {
			if (!this.busyDetail) {
				return;
			}

			this.busyDetail = undefined;
			this.emit();
		};

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
					attachments,
					signal: controller.signal,
					confirm: (req) => this.requestConfirm(req),
					revealFile: revealAgentFile,
					plan: this.stickyPlan,
					onPlanChanged: () => this.onPlanChanged(),
					checkpoint,
					writes: this.writes,
					planEditsAppendix: planReload.planEditsAppendix,
					mode: settings.chatMode,
					sessionAllow: this.sessionAllow,
					onAlwaysAllow: (pattern) => {
						if (pattern && !this.sessionAllow.includes(pattern)) {
							this.sessionAllow.push(pattern);
						}
					},
					setChatMode: (mode) => this.setMode(mode),
					onRetry,
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
							if (typeof patch.content === 'string' && patch.content.length > 0) {
								clearRetryStatus();
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
				const rulesParts: string[] = [];
				const personaId = getSettings().personaId.trim();
				if (personaId) {
					const persona = await resolvePersona(personaId);
					if (persona) {
						rulesParts.push(formatPersonaAppendix(persona));
					}
				}
				const projectRules =
					(await loadProjectRulesAppendix())
					?? getGenRulesManager()?.getPromptAppendix();
				if (projectRules?.trim()) {
					rulesParts.push(projectRules.trim());
				}
				const result = await this.client.complete({
					messages: await buildChatCompletionMessages(
						historyForAsk,
						llmUserText,
						mergedContext,
						rulesParts.length ? rulesParts.join('\n\n') : undefined,
						attachments,
					),
					signal: controller.signal,
					onDelta: (chunk) => {
						if (this.clearSeq !== clearSeqAtStart) {
							return;
						}
						clearRetryStatus();
						streamed += chunk;
						this.update(assistantId, {
							content: streamed
						});
					},
					onRetry,
				});
				if (this.clearSeq === clearSeqAtStart) {
					clearRetryStatus();
					this.update(assistantId, {
						content: result.content.trim() || streamed,
						usage: result.usage,
					});
				}
			}
			turnOk = !controller.signal.aborted;
		} catch (err) {
			turnOk = false;
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
			this.busyDetail = undefined;
			if (this.clearSeq === clearSeqAtStart) {
				this.persist();
				this.emit();
			}
		}

		if (this.clearSeq !== clearSeqAtStart) {
			return;
		}

		if (turnOk) {
			await this.maybeRenameSessionAfterTurn(controller.signal);
		}

		if (checkpoint.size > 0) {
			const restored = await offerCheckpointRestore(checkpoint);
			if (restored.length > 0) {
				this.writes.clear();
				this.lastCheckpoint = undefined;
				// Пользователь откатил файлы сразу - не держим checkpoint в undo
				const top = this.undoStack[this.undoStack.length - 1];
				if (top) {
					top.checkpoint = undefined;
				}
			} else {
				this.lastCheckpoint = checkpoint;
				const top = this.undoStack[this.undoStack.length - 1];
				if (top) {
					top.checkpoint = checkpoint;
				}
			}
		}

		const usage = sumUsage(this.messages);
		if (usage && usage.totalTokens > 0) {
			writeLog('agent', `[${new Date().toISOString()}] session tokens prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens}`);
		}

		if (getSettings().notifyOnComplete && !controller.signal.aborted) {
			void vscode.window.showInformationMessage(vscode.l10n.t('chat.notify.complete'));
		}

		await this.drainTurnQueue();
	}

	/** После первого успешного хода: LLM-title на smallModel, если ещё «Новый чат». */
	private async maybeRenameSessionAfterTurn(signal: AbortSignal): Promise<void> {
		const current = this.sessions.getCurrent();
		if (!isDefaultSessionTitle(current.title)) {
			return;
		}

		const userTurns = this.messages.filter((m) => m.role === 'user').length;
		if (userTurns < 1) {
			return;
		}

		const sessionId = current.id;
		let title = await generateSessionTitle(this.messages, this.client, { signal });
		if (!title?.trim()) {
			title = fallbackTitleFromMessages(this.messages);
		}

		if (!title?.trim() || isDefaultSessionTitle(title)) {
			return;
		}

		if (this.sessions.getCurrentSessionId() !== sessionId) {
			return;
		}

		if (this.sessions.renameSession(sessionId, title)) {
			this.emit();
		}
	}

	async exportSessionMarkdown(): Promise<void> {
		const lines = this.messages.map((m) => {
			if (m.role === 'user') {
				return `## Пользователь\n\n${m.content}`;
			}

			if (m.role === 'assistant') {
				return `## Ассистент\n\n${m.content}`;
			}

			if (m.role === 'error') {
				return `## Ошибка\n\n${m.content}`;
			}

			return `## Tool ${m.toolName ?? ''}\n\n\`\`\`\n${m.content}\n\`\`\``;
		});
		const doc = await vscode.workspace.openTextDocument({
			content: `# Экспорт чата Gen\n\n${lines.join('\n\n')}\n`,
			language: 'markdown',
		});
		await vscode.window.showTextDocument(doc, { preview: false });
	}

	async runInitRules(hint?: string): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			this.append({
				id: messageId(),
				role: 'error',
				content: vscode.l10n.t('policy.noWorkspace'),
			});
			return;
		}

		const uri = vscode.Uri.joinPath(folder.uri, 'AGENTS.md');
		const stub = [
			'# AGENTS.md',
			'',
			'Правила проекта для Gen / coding-агентов.',
			'',
			hint ? `## Заметки\n\n${hint}` : '## Обзор\n\nОпиши архитектуру, соглашения и ограничения проекта.',
			'',
		].join('\n');
		try {
			await vscode.workspace.fs.stat(uri);
			this.append({
				id: messageId(),
				role: 'assistant',
				content: 'AGENTS.md уже есть. Отредактируй его или добавь `.genrules` для правил Gen.',
			});
		} catch {
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(stub));
			this.append({
				id: messageId(),
				role: 'assistant',
				content: 'Создан AGENTS.md в корне workspace. Заполни правила проекта для агента.',
			});
			await vscode.window.showTextDocument(uri);
		}
		this.emit();
	}

	async addSelectionToChat(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.selection.isEmpty) {
			return;
		}
		
		const doc = editor.document;
		const text = doc.getText(editor.selection);
		const rel = vscode.workspace.asRelativePath(doc.uri);
		const start = editor.selection.start.line + 1;
		const end = editor.selection.end.line + 1;
		const mention = `@file ${rel}`;
		const block = `${mention}\n\`\`\`\n${text.slice(0, 8000)}\n\`\`\`\n(lines ${start}-${end})`;
		await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
		await this.send(block);
	}
}
