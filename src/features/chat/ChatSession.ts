import * as vscode from 'vscode';
import { AgentSession, isAbortError } from '../agent';
import { AgentCheckpoint, offerCheckpointRestore } from '../agent/checkpoint';
import { StickyPlan } from '../agent/plan';
import { WorkspacePlanStore } from '../agent/planStore';
import { PLAN_ENTER_REMINDER, PLAN_EXIT_REMINDER } from '../agent/tools/plan/modeSwitch';
import type { ConfirmChoice } from '../agent/types';
import { getSettings, isAgentLikeMode, setSessionModel, updateSettings } from '../../core/config/settings';
import type { ChatMode } from '../../core/config/types';
import { writeLog } from '../../core/log/logger';
import type { LlmClient } from '../../core/llm/types';
import { sumUsage } from '../../core/llm/usage';
import { resolveBangCommands } from './bangCommand';
import { compactChatMessages } from './compact';
import { completeWithContextGuard, resolveContextBudget } from './fitContext';
import { estimateChatMessagesTokens } from '../../core/llm/estimateTokens';
import type { ChatMessage } from '../../core/llm/types';
import { resolveMentions } from './mentions';
import { buildChatCompletionMessages } from './buildChatCompletionMessages';
import { injectImagePathMarkers, saveImageAttachments } from './attachments';
import type { ImageAttachment, IncomingImage } from './attachments';
import { getEditorChatContext } from './editorContext';
import { focusChatView } from './focusChat';
import type { AgentPausedState, ChatTodoItem, ChatUiMessage, ChatViewState, PendingConfirm, SessionDiffEvent, ToWebviewMessage } from './protocol';
import { recordActivity } from '../../core/stores/activityStore';
import { SessionStore, fallbackTitleFromMessages, isDefaultSessionTitle, setSessionPeek } from './sessionStore';
import { abortSessionRuntime, createSessionRuntime } from './sessionRuntime';
import type { PendingConfirmInternal, PendingQuestionInternal, SessionRuntime } from './sessionRuntime';
import { generateSessionTitle } from '../agent/systemAgents';
import { loadProjectRulesAppendix } from '../project/projectRules';
import { parseSlashMode, type SlashCommand } from './slashCommands';
import { parseExportedMarkdown } from './sessionImport';
import { getAlwaysOnWorkspaceContext } from './workspaceContext';
import type { DiffHunkPayload } from '../agent/diff';
import { revertHunkInText } from '../agent/diff';
import { pathExists, resolveWorkspacePath } from '../agent/workspacePath';
import { startGitSyncAutoKeep } from './gitSyncKeep';
import { customToSlashCommand, discoverCustomCommands, expandCommandTemplate } from '../project/customCommands';
import type { CustomCommand } from '../project/customCommands';
import { getGenRulesManager } from '../project/genrules';
import { formatPersonaAppendix, resolvePersona } from '../project/personas';
import { runBeforeSubmitHook, runSessionCompactingHook, runSessionDiffHook } from '../project/hooks';
import { ensureGenScaffold } from '../project/config';

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

async function revealAgentFile(uri: vscode.Uri): Promise<void> {
	const mode = getSettings().revealOnEdit;
	if (mode === 'never') {
		return;
	}

	if (mode === 'preview') {
		await vscode.window.showTextDocument(uri, {
			preview: true,
			preserveFocus: true
		});
		return;
	}

	// focus - прежнее поведение (preview + фокус редактора)
	await vscode.window.showTextDocument(uri, { preview: true });
}

type ChatSessionListener = (state: ChatViewState) => void;

export class ChatSession {
	// Runtime текущей вкладки (messages / inflight / queue / ...)
	private runtime!: SessionRuntime;
	// Все живые runtime по sessionId - concurrent runs между вкладками
	private readonly runtimes = new Map<string, SessionRuntime>();
	// postMessage в chat webview (playNotifySound и т.п.)
	private postToWebview?: (message: ToWebviewMessage) => void;
	private readonly listeners = new Set<ChatSessionListener>();
	private readonly agent: AgentSession;
	private readonly stickyPlan = new StickyPlan();
	private readonly planStore: WorkspacePlanStore;
	private planBootstrapped = false;
	private readonly subs: vscode.Disposable[] = [];
	private customCommands: CustomCommand[] = [];
	// Ключ dismissed handoff (title), чтобы баннер не мигал после dismiss
	private dismissedPlanHandoffKey?: string;
	private readonly sessions: SessionStore;
	// Поллинг git-sync auto-Keep (пока есть pending-хунки и setting вкл.)
	private gitSyncKeepDisposable?: { dispose(): void };

	private get messages(): ChatUiMessage[] {
		return this.runtime.messages;
	}
	
	private set messages(value: ChatUiMessage[]) {
		this.runtime.messages = value;
	}
	
	private get inflight(): AbortController | undefined {
		return this.runtime.inflight;
	}
	
	private set inflight(value: AbortController | undefined) {
		this.runtime.inflight = value;
	}
	
	private get busyDetail(): string | undefined { 
		return this.runtime.busyDetail; 
	}
	
	private set busyDetail(value: string | undefined) { 
		this.runtime.busyDetail = value;
	}
	
	private get turnQueue() { 
		return this.runtime.turnQueue; 
	}
	
	private get pendingConfirm(): PendingConfirmInternal | undefined {
		return this.runtime.pendingConfirm;
	}
	
	private set pendingConfirm(value: PendingConfirmInternal | undefined) {
		this.runtime.pendingConfirm = value;
	}
	
	private get pendingQuestion(): PendingQuestionInternal | undefined {
		return this.runtime.pendingQuestion;
	}
	
	private set pendingQuestion(value: PendingQuestionInternal | undefined) {
		this.runtime.pendingQuestion = value;
	}
	
	private get todos(): ChatTodoItem[] {
		return this.runtime.todos;
	}
	
	private set todos(value: ChatTodoItem[]) { 
		this.runtime.todos = value;
	}
	
	private get agentPaused(): AgentPausedState | undefined { 
		return this.runtime.agentPaused; 
	}
	
	private set agentPaused(value: AgentPausedState | undefined) { 
		this.runtime.agentPaused = value;
	}
	
	private get toolAborts() {
		return this.runtime.toolAborts;
	}
	
	private get activeToolCallId(): string | undefined {
		return this.runtime.activeToolCallId;
	}
	
	private set activeToolCallId(value: string | undefined) { 
		this.runtime.activeToolCallId = value; 
	}
	
	private get sessionAllow() { 
		return this.runtime.sessionAllow;
	}
	
	private get lastCheckpoint(): AgentCheckpoint | undefined { 
		return this.runtime.lastCheckpoint; 
	}
	
	private set lastCheckpoint(value: AgentCheckpoint | undefined) {
		this.runtime.lastCheckpoint = value;
	}
	
	private get undoStack() {
		return this.runtime.undoStack;
	}
	
	private get redoStack() { 
		return this.runtime.redoStack; 
	}
	
	private get exportArchive(): ChatUiMessage[] | undefined { 
		return this.runtime.exportArchive; 
	}
	
	private set exportArchive(value: ChatUiMessage[] | undefined) { 
		this.runtime.exportArchive = value; 
	}
	
	private get lastTurnDiff(): SessionDiffEvent | undefined { 
		return this.runtime.lastTurnDiff; 
	}
	
	private set lastTurnDiff(value: SessionDiffEvent | undefined) { 
		this.runtime.lastTurnDiff = value; 
	}
	
	private get writes() { 
		return this.runtime.writes; 
	}
	
	private get clearSeq(): number { 
		return this.runtime.clearSeq; 
	}

	private set clearSeq(value: number) { 
		this.runtime.clearSeq = value; 
	}

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly client: LlmClient,
	) {
		this.sessions = new SessionStore(this.context.workspaceState);
		setSessionPeek(this.sessions);
		const currentId = this.sessions.getCurrentSessionId();
		this.runtime = this.ensureRuntime(currentId);
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
		this.stopGitSyncAutoKeep();
		setSessionPeek(undefined);
		this.planStore.dispose();
		for (const rt of this.runtimes.values()) {
			abortSessionRuntime(rt);
		}

		this.runtimes.clear();
		for (const sub of this.subs) {
			sub.dispose();
		}

		this.subs.length = 0;
	}

	getState(): ChatViewState {
		const settings = getSettings();
		const customSlashCommands: SlashCommand[] = this.customCommands.map(customToSlashCommand);
		const planSnap = this.stickyPlan.snapshot();
		const handoffKey = planSnap?.approved ? planSnap.title : undefined;
		const planHandoff = settings.chatMode === 'plan' && planSnap?.approved && handoffKey !== this.dismissedPlanHandoffKey
			? { 
				title: planSnap.title 
			}
			: undefined;
		return {
			messages: this.messages,
			busy: Boolean(this.inflight),
			busyDetail: this.busyDetail,
			queuedCount: this.turnQueue.length,
			mode: settings.chatMode,
			usage: sumUsage(this.messages),
			maxContextTokens: settings.maxContextTokens,
			sessionId: this.sessions.getCurrentSessionId(),
			sessions: this.listSessionsWithBusy(),
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
			pendingQuestion: this.pendingQuestion
				? {
					id: this.pendingQuestion.id,
					title: this.pendingQuestion.title,
					prompt: this.pendingQuestion.prompt,
					options: this.pendingQuestion.options,
				}
				: undefined,
			todos: this.todos.length > 0 ? this.todos.map((item) => ({ ...item })) : undefined,
			agentPaused: this.agentPaused,
			activeToolCallId: this.activeToolCallId,
			chatTextSize: settings.chatTextSize,
			planHandoff,
			model: settings.model,
			lastTurnDiff: this.lastTurnDiff
				? {
					turnId: this.lastTurnDiff.turnId,
					paths: [...this.lastTurnDiff.paths],
					at: this.lastTurnDiff.at,
				}
				: undefined,
			composerDraft: this.sessions.getDraft() || undefined,
			composerChips: (() => {
				const chips = this.sessions.getDraftChips();
				return chips.length > 0 ? chips : undefined;
			})(),
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

	// Привязать postMessage к chat webview (ChatViewProvider)
	setWebviewPoster(post: (message: ToWebviewMessage) => void): void {
		this.postToWebview = post;
	}

	private emit(): void {
		const state = this.getState();
		for (const listener of this.listeners) {
			listener(state);
		}

		// После emit: при pending-хунках и gitSyncAutoKeep - поллинг auto-Keep
		this.ensureGitSyncAutoKeep();
	}

	// Information Message + опциональный beep в webview
	private notifyTurnComplete(signal: AbortSignal, paused: boolean): void {
		const settings = getSettings();
		if (!settings.notifyOnComplete || signal.aborted || paused) {
			return;
		}

		void vscode.window.showInformationMessage(vscode.l10n.t('chat.notify.complete'));
		if (settings.notifySoundOnComplete) {
			this.postToWebview?.({ 
				type: 'playNotifySound' 
			});
		}
	}

	private persist(sessionId?: string): void {
		const id = sessionId ?? this.sessions.getCurrentSessionId();
		const rt = this.ensureRuntime(id);
		this.sessions.saveMessages(rt.messages.slice(-MAX_STORED), id);
	}

	// Runtime для sessionId: из Map или из persisted messages
	private ensureRuntime(sessionId: string): SessionRuntime {
		let rt = this.runtimes.get(sessionId);
		if (rt) {
			return rt;
		}

		const stored = this.sessions.getSession(sessionId);
		rt = createSessionRuntime(stored?.messages ?? []);
		this.runtimes.set(sessionId, rt);
		return rt;
	}

	// Сделать runtime текущим (без abort чужих runs)
	private activateRuntime(sessionId: string): void {
		this.runtime = this.ensureRuntime(sessionId);
	}

	// Список сессий с флагом busy для UI вкладок
	private listSessionsWithBusy() {
		return this.sessions.listSessions().map((s) => ({
			...s,
			busy: Boolean(this.runtimes.get(s.id)?.inflight),
		}));
	}

	// Число активных agent/ask runs по всем вкладкам
	private countInflightRuns(): number {
		let n = 0;
		for (const rt of this.runtimes.values()) {
			if (rt.inflight) {
				n += 1;
			}
		}
		return n;
	}

	// Можно ли открыть ещё одну вкладку (maxTabCount)
	private canCreateTab(): boolean {
		const max = getSettings().maxTabCount;
		return this.sessions.listSessions().length < max;
	}

	// Можно ли стартовать новый run (не считая уже busy текущей вкладки - там очередь)
	private canStartConcurrentRun(): boolean {
		const max = getSettings().maxConcurrentRuns;
		return this.countInflightRuns() < max;
	}

	private notifyMaxTabs(): void {
		const max = getSettings().maxTabCount;
		void vscode.window.showWarningMessage(vscode.l10n.t('chat.session.maxTabs', max));
	}

	private notifyMaxConcurrentRuns(): void {
		const max = getSettings().maxConcurrentRuns;
		void vscode.window.showWarningMessage(vscode.l10n.t('chat.session.maxConcurrentRuns', max));
	}

	listSessions() {
		return this.listSessionsWithBusy();
	}

	createSession(): void {
		if (!this.canCreateTab()) {
			this.notifyMaxTabs();
			return;
		}

		this.persist();
		const created = this.sessions.createSession();
		this.activateRuntime(created.id);
		this.emit();
	}

	switchSession(id: string): void {
		if (id === this.sessions.getCurrentSessionId()) {
			return;
		}

		this.persist();
		const next = this.sessions.switchSession(id);
		if (!next) {
			return;
		}

		// Не абортим чужой run - только переключаем UI на runtime вкладки
		this.activateRuntime(id);
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
		const rt = this.runtimes.get(id);
		if (rt) {
			abortSessionRuntime(rt);
			this.runtimes.delete(id);
		}

		if (!this.sessions.deleteSession(id)) {
			return;
		}

		if (wasCurrent) {
			this.activateRuntime(this.sessions.getCurrentSessionId());
		}

		this.emit();
	}

	forkFromMessage(messageId: string): void {
		if (!this.canCreateTab()) {
			this.notifyMaxTabs();
			return;
		}

		this.persist();
		const forked = this.sessions.forkFromMessage(this.sessions.getCurrentSessionId(), messageId);
		if (!forked) {
			void vscode.window.showWarningMessage(vscode.l10n.t('chat.session.forkFailed'));
			return;
		}

		this.activateRuntime(forked.id);
		this.emit();
	}

	// Обновить черновик Composer (sessionId - чтобы debounce не писал в чужую сессию)
	setComposerDraft(text: string, chips?: string[], sessionId?: string): void {
		this.sessions.setDraft(text, chips, sessionId);
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

	private append(message: ChatUiMessage, sessionId?: string): void {
		const id = sessionId ?? this.sessions.getCurrentSessionId();
		const rt = this.ensureRuntime(id);
		rt.messages = [...rt.messages, message].slice(-MAX_STORED);
		this.sessions.saveMessages(rt.messages, id);
		this.emit();
	}

	private update(id: string, patch: Partial<ChatUiMessage>, sessionId?: string): void {
		const sid = sessionId ?? this.sessions.getCurrentSessionId();
		const rt = this.ensureRuntime(sid);
		rt.messages = rt.messages.map((msg) => (msg.id === id ? {
			...msg,
			...patch
		} : msg));
		if (patch.toolCalls || patch.usage) {
			this.sessions.saveMessages(rt.messages, sid);
		}

		this.emit();
	}

	// Переключить UI на вкладку (для confirm/question фонового run)
	private focusSession(sessionId: string): void {
		if (sessionId === this.sessions.getCurrentSessionId()) {
			void focusChatView();
			return;
		}

		this.persist();
		if (!this.sessions.switchSession(sessionId)) {
			return;
		}

		this.activateRuntime(sessionId);
		this.emit();
		void focusChatView();
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
	}, sessionId?: string): Promise<ConfirmChoice> {
		const sid = sessionId ?? this.sessions.getCurrentSessionId();
		this.focusSession(sid);

		if (this.pendingConfirm) {
			this.settleConfirm('abort');
		}

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

	private settleQuestion(answer: string): void {
		const pending = this.pendingQuestion;
		if (!pending) {
			return;
		}
		this.pendingQuestion = undefined;
		this.emit();
		pending.resolve(answer);
	}

	answerQuestion(id: string, answer: string): void {
		if (!this.pendingQuestion || this.pendingQuestion.id !== id) {
			return;
		}
		this.settleQuestion(answer);
	}

	async requestQuestion(request: {
		title: string;
		prompt: string;
		options?: string[];
	}, sessionId?: string): Promise<string> {
		const sid = sessionId ?? this.sessions.getCurrentSessionId();
		this.focusSession(sid);

		if (this.pendingQuestion) {
			this.settleQuestion('');
		}

		return new Promise<string>((resolve) => {
			this.pendingQuestion = {
				id: messageId(),
				title: request.title,
				prompt: request.prompt,
				options: request.options?.length ? [...request.options] : undefined,
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
		this.clearToolAborts();
		this.agentPaused = undefined;
		this.settleConfirm('abort');
		this.settleQuestion('');
		this.todos = [];
		this.writes.clear();
		this.lastCheckpoint = undefined;
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this.exportArchive = undefined;
		this.messages = [];
		this.lastTurnDiff = undefined;
		this.stopGitSyncAutoKeep();
		this.persist();
		this.emit();
	}

	// Стоп: прервать текущий turn и сбросить очередь ожидающих сообщений
	cancel(): void {
		this.turnQueue.length = 0;
		this.inflight?.abort();
		this.clearToolAborts();
		this.agentPaused = undefined;
		this.settleConfirm('abort');
		this.settleQuestion('');
		this.emit();
	}

	// Снять мягкую паузу без продолжения агента
	stopAgentPause(): void {
		if (!this.agentPaused) {
			return;
		}

		this.agentPaused = undefined;
		this.emit();
	}

	// Отмена одного tool (не всего turn). Если контроллера нет - abort turn
	cancelToolCall(id: string): void {
		const ctrl = this.toolAborts.get(id);
		if (ctrl) {
			ctrl.abort();
			return;
		}

		this.inflight?.abort();
	}

	// Continue после лимита итераций - тот же history + nudge, новый бюджет N
	async continueAgent(): Promise<void> {
		if (!this.agentPaused || this.inflight) {
			return;
		}

		this.agentPaused = undefined;
		this.emit();
		await this.runContinueTurn();
	}

	private clearToolAborts(): void {
		for (const ctrl of this.toolAborts.values()) {
			ctrl.abort();
		}

		this.toolAborts.clear();
		this.activeToolCallId = undefined;
	}

	private onToolStart(id: string, ctrl: AbortController): void {
		this.toolAborts.set(id, ctrl);
		this.activeToolCallId = id;
		this.emit();
	}

	private onToolEnd(id: string): void {
		this.toolAborts.delete(id);
		if (this.activeToolCallId === id) {
			this.activeToolCallId = undefined;
		}
		this.emit();
	}

	// Правит сообщение пользователя, отбрасывает всё после него и заново запускает ход
	async editMessage(
		id: string,
		content: string,
		opts?: {
			revertFiles?: boolean
		},
	): Promise<void> {
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
		this.settleQuestion('');

		// Опциональный best-effort откат мутаций файлов агента с этого хода и далее
		if (opts?.revertFiles) {
			await this.restoreCheckpointsAfterMessage(idx);
		}

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

	/**
	 * Best-effort restore правок агента начиная с хода отредактированного user-сообщения.
	 * Берём checkpoint из undoStack (и lastCheckpoint), восстанавливаем от новых к старым.
	 * Записи стека, относящиеся к этому и более поздним ходам, вычищаются.
	 */
	private async restoreCheckpointsAfterMessage(messageIdx: number): Promise<void> {
		const seen = new Set<AgentCheckpoint>();
		const checkpoints: AgentCheckpoint[] = [];

		const pushUnique = (checkpoint: AgentCheckpoint | undefined) => {
			if (!checkpoint || checkpoint.size <= 0 || seen.has(checkpoint)) {
				return;
			}

			seen.add(checkpoint);
			checkpoints.push(checkpoint);
		};

		// Сначала lastCheckpoint (самый свежий ход), затем undoStack с конца
		pushUnique(this.lastCheckpoint);
		for (let i = this.undoStack.length - 1; i >= 0; i -= 1) {
			const entry = this.undoStack[i];
			// entry.messages - история ДО user-сообщения хода; length >= idx * этот ход или позже
			if (entry && entry.messages.length >= messageIdx) {
				pushUnique(entry.checkpoint);
			}
		}

		for (const checkpoint of checkpoints) {
			await checkpoint.restore();
		}

		this.writes.clear();
		this.lastCheckpoint = undefined;
		this.redoStack.length = 0;

		// Убрать из undo записи ходов начиная с отредактированного
		while (this.undoStack.length > 0) {
			const top = this.undoStack[this.undoStack.length - 1];
			if (top && top.messages.length >= messageIdx) {
				this.undoStack.pop();
				continue;
			}
			break;
		}
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
		recordActivity({
			kind: 'review',
			label: action === 'accept'
				? `Принято: ${hunk.path ?? found.call.path ?? hunkId}`
				: `Отклонено: ${hunk.path ?? found.call.path ?? hunkId}`,
			path: hunk.path ?? found.call.path,
			sessionId: this.sessions.getCurrentSessionId(),
			toolName: found.call.name,
			status: action === 'accept' ? 'accepted' : 'rejected',
		});
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

		const pathHint = found.call.path ?? pending[0]?.path;
		recordActivity({
			kind: 'review',
			label: action === 'acceptAll'
				? `Принято все: ${pending.length} хунк(ов)${pathHint ? ` (${pathHint})` : ''}`
				: `Отклонено все: ${pending.length} хунк(ов)${pathHint ? ` (${pathHint})` : ''}`,
			path: pathHint,
			sessionId: this.sessions.getCurrentSessionId(),
			toolName: found.call.name,
			status: action === 'acceptAll' ? 'accepted' : 'rejected',
		});

		this.persist();
		this.emit();
	}

	// Уникальные relative-пути с хотя бы одним pending-хунком
	private getPendingHunkPaths(): string[] {
		const pathSet = new Set<string>();
		for (const msg of this.messages) {
			for (const call of msg.toolCalls ?? []) {
				for (const hunk of call.hunks ?? []) {
					if (hunk.status !== 'pending') {
						continue;
					}
					const path = (hunk.path ?? call.path)?.trim();
					if (path) {
						pathSet.add(path);
					}
				}
			}
		}
		return [...pathSet];
	}

	// Accept/Reject всех pending-хунков одного файла (сессионная панель / git-sync Keep)
	async reviewPendingPath(relativePath: string, action: 'accept' | 'reject'): Promise<void> {
		if (action === 'accept') {
			this.acceptPendingPath(relativePath);
			return;
		}

		await this.rejectPendingPath(relativePath);
	}

	// Reject всех pending-хунков по path (как reviewDiff rejectAll, только для файла)
	private async rejectPendingPath(relativePath: string): Promise<void> {
		if (this.inflight) {
			return;
		}

		const target = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
		if (!target) {
			return;
		}

		const pending: DiffHunkPayload[] = [];
		for (const msg of this.messages) {
			for (const call of msg.toolCalls ?? []) {
				for (const hunk of call.hunks ?? []) {
					if (hunk.status !== 'pending') {
						continue;
					}

					const path = (hunk.path ?? call.path)?.replace(/\\/g, '/').replace(/^\.\//, '').trim();
					if (path === target) {
						pending.push(hunk);
					}
				}
			}
		}

		if (pending.length === 0) {
			return;
		}

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

		recordActivity({
			kind: 'review',
			label: `Отклонено (файл): ${pending.length} хунк(ов) (${target})`,
			path: target,
			sessionId: this.sessions.getCurrentSessionId(),
			status: 'rejected',
		});

		this.persist();
		this.emit();
	}

	/**
	 * Accept всех pending-хунков по path (как reviewDiff acceptAll, только для файла).
	 * Диск не трогаем - Keep = оставить текущее состояние.
	 */
	private acceptPendingPath(relativePath: string): void {
		if (this.inflight) {
			return;
		}

		const target = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
		if (!target) {
			return;
		}

		let changed = false;
		for (const msg of this.messages) {
			for (const call of msg.toolCalls ?? []) {
				for (const hunk of call.hunks ?? []) {
					if (hunk.status !== 'pending') {
						continue;
					}

					const path = (hunk.path ?? call.path)?.replace(/\\/g, '/').replace(/^\.\//, '').trim();
					if (path !== target) {
						continue;
					}

					hunk.status = 'accepted';
					changed = true;
				}
			}
		}

		if (!changed) {
			return;
		}

		recordActivity({
			kind: 'review',
			label: `Принято (auto-Keep): ${target}`,
			path: target,
			sessionId: this.sessions.getCurrentSessionId(),
			status: 'accepted',
		});

		this.persist();
		this.emit();
	}

	private stopGitSyncAutoKeep(): void {
		this.gitSyncKeepDisposable?.dispose();
		this.gitSyncKeepDisposable = undefined;
	}

	// Старт/стоп поллинга: setting + есть pending
	private ensureGitSyncAutoKeep(): void {
		const enabled = getSettings().gitSyncAutoKeep;
		const pending = this.getPendingHunkPaths();
		if (!enabled || pending.length === 0) {
			this.stopGitSyncAutoKeep();
			return;
		}

		if (this.gitSyncKeepDisposable) {
			return;
		}

		this.gitSyncKeepDisposable = startGitSyncAutoKeep({
			getPendingPaths: () => this.getPendingHunkPaths(),
			acceptPath: (path) => {
				this.acceptPendingPath(path);
			},
			isBusy: () => Boolean(this.inflight),
		});
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
		const prev = getSettings().chatMode;
		await updateSettings({
			...getSettings(),
			chatMode: mode
		});

		// После перехода в agent баннер handoff больше не нужен
		if (mode === 'agent') {
			this.dismissedPlanHandoffKey = undefined;
		}

		// Synthetic reminders Plan ↔ Agent (UI / slash / tools * setChatMode)
		if (prev !== mode) {
			if (mode === 'plan') {
				this.append({
					id: messageId(),
					role: 'assistant',
					content: PLAN_ENTER_REMINDER,
				});
			} else if (prev === 'plan' && mode === 'agent') {
				this.append({
					id: messageId(),
					role: 'assistant',
					content: PLAN_EXIT_REMINDER,
				});
			}
		}
		this.emit();
	}

	// Сменить session-модель (не пишется в persistent settings.model)
	setModel(model: string): void {
		setSessionModel(model.trim());
		this.emit();
	}

	// Скрыть баннер Plan * Agent без смены режима
	dismissPlanHandoff(): void {
		const snap = this.stickyPlan.snapshot();
		if (snap?.approved) {
			this.dismissedPlanHandoffKey = snap.title;
		}
		this.emit();
	}

	// Скрыть баннер session diff последнего хода
	dismissTurnDiff(): void {
		if (!this.lastTurnDiff) {
			return;
		}
		this.lastTurnDiff = undefined;
		this.emit();
	}

	async send(text: string, images?: IncomingImage[]): Promise<void> {
		const trimmed = text.trim();
		const hasImages = Boolean(images?.length);
		if (!trimmed && !hasImages) {
			return;
		}

		// Успешный приём send - очистить черновик текущей сессии
		this.sessions.clearDraft();

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

			if (slash.command === 'import') {
				await this.importSessionMarkdown();
				return;
			}

			if (slash.command === 'init') {
				await this.runInitRules(slash.rest);
				return;
			}

			if (slash.command === 'new') {
				if (!this.canCreateTab()) {
					this.notifyMaxTabs();
					return;
				}
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

		// Новая вкладка без inflight - лимит параллельных runs по всем табам
		if (!this.canStartConcurrentRun()) {
			this.notifyMaxConcurrentRuns();
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

	/**
	 * Preflight: если история не влезает в budget и policy=auto - сжатие без slash /compact.
	 * Возвращает true, если messages изменились.
	 */
	private async maybeAutoCompactBeforeTurn(
		signal: AbortSignal,
		excludeMessageIds: ReadonlySet<string> = new Set(),
	): Promise<boolean> {
		const settings = getSettings();
		if (settings.contextOverflowPolicy !== 'auto_compact_retry') {
			return false;
		}

		const source = this.messages.filter((m) => !excludeMessageIds.has(m.id));
		// Грубая оценка UI*API: content lengths
		const rough: ChatMessage[] = source.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
			.map((m) => {
				if (m.role === 'tool') {
					return { 
						role: 'tool' as const, 
						tool_call_id: m.toolCallId ?? 'x', 
						content: m.content 
					};
				}
				return { 
					role: m.role as 'user' | 'assistant', 
					content: m.content 
				};
			});
		const budget = resolveContextBudget(settings);
		if (estimateChatMessagesTokens(rough) <= budget) {
			return false;
		}

		this.busyDetail = vscode.l10n.t('chat.contextOverflow.compacting');
		this.emit();
		try {
			const result = await compactChatMessages(source, this.client, {
				signal,
				keepTurns: settings.compactTailTurns,
				pruneToolResults: settings.compactPruneToolResults,
				reservedTokens: settings.compactReservedTokens,
			});
			if (!result.compacted) {
				return false;
			}

			if (!this.exportArchive) {
				this.exportArchive = cloneMessages(source);
			}

			const excluded = this.messages.filter((m) => excludeMessageIds.has(m.id));
			this.messages = [...result.messages, ...excluded].slice(-MAX_STORED);
			this.persist();
			this.emit();
			return true;
		} finally {
			this.busyDetail = undefined;
			this.emit();
		}
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
			// session.compacting: veto при ненулевом exit
			const compactHook = await runSessionCompactingHook(controller.signal);
			if (compactHook.vetoed) {
				this.append({
					id: messageId(),
					role: 'error',
					content: compactHook.stderr?.trim()
						|| vscode.l10n.t('chat.hooks.veto', 'session.compacting', compactHook.command ?? ''),
				});
				return;
			}

			const settings = getSettings();
			const result = await compactChatMessages(this.messages, this.client, {
				signal: controller.signal,
				keepTurns: settings.compactTailTurns,
				pruneToolResults: settings.compactPruneToolResults,
				reservedTokens: settings.compactReservedTokens,
			});
			if (!result.compacted) {
				this.append({
					id: messageId(),
					role: 'assistant',
					content: result.reason ?? vscode.l10n.t('chat.compact.nothingToDo', settings.compactTailTurns),
				});
				return;
			}

			// Сохраняем полную историю только при первом compact; повторный - не перезаписывает архив
			if (!this.exportArchive) {
				this.exportArchive = cloneMessages(this.messages);
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

	// После завершения turn - взять следующее из очереди этой вкладки
	private async drainTurnQueue(sessionId: string): Promise<void> {
		const rt = this.ensureRuntime(sessionId);
		if (rt.inflight) {
			return;
		}

		const next = rt.turnQueue.shift();
		if (!next) {
			this.emit();
			return;
		}

		if (!this.canStartConcurrentRun()) {
			rt.turnQueue.unshift(next);
			this.notifyMaxConcurrentRuns();
			this.emit();
			return;
		}

		this.emit();
		this.append({
			id: messageId(),
			role: 'user',
			content: next.text,
			attachments: next.attachments,
		}, sessionId);
		await this.runTurn(next.text, next.attachments, sessionId);
	}

	// Запуск хода: последнее сообщение уже user с этим текстом (sessionId - вкладка run)
	private async runTurn(
		trimmed: string,
		attachments?: readonly ImageAttachment[],
		sessionId?: string,
	): Promise<void> {
		const runSessionId = sessionId ?? this.sessions.getCurrentSessionId();
		const rt = this.ensureRuntime(runSessionId);
		if (rt.inflight) {
			return;
		}

		if (!this.canStartConcurrentRun()) {
			this.notifyMaxConcurrentRuns();
			return;
		}

		rt.todos = [];
		rt.agentPaused = undefined;
		const clearSeqAtStart = rt.clearSeq;
		const controller = new AbortController();
		// Сразу резервируем слот concurrent (до await), чтобы другие вкладки не обогнали
		rt.inflight = controller;
		rt.busyDetail = undefined;
		this.emit();

		const settings = getSettings();
		if (!settings.baseUrl.trim()) {
			rt.inflight = undefined;
			this.append({
				id: messageId(),
				role: 'error',
				content: vscode.l10n.t('chat.error.missingUrlOrModel'),
			}, runSessionId);
			this.emit();
			return;
		}

		if (!(await this.ensureSessionModel())) {
			if (rt.inflight === controller) {
				rt.inflight = undefined;
			}
			this.append({
				id: messageId(),
				role: 'error',
				content: vscode.l10n.t('chat.error.missingUrlOrModel'),
			}, runSessionId);
			this.emit();
			return;
		}

		const historyBeforeUser = rt.messages.slice(0, -1);
		const snapshotEnabled = settings.snapshotEnabled !== false;
		const checkpoint = new AgentCheckpoint(snapshotEnabled);
		// Стек undo: снимок сообщений до хода; checkpoint допишем в конце (если snapshot вкл.)
		if (snapshotEnabled) {
			rt.undoStack.push({
				messages: cloneMessages(historyBeforeUser),
				checkpoint: undefined,
			});
			if (rt.undoStack.length > MAX_TURN_HISTORY) {
				rt.undoStack.shift();
			}
			rt.redoStack.length = 0;
		}
		const mentions = await resolveMentions(trimmed);
		const bangs = await resolveBangCommands(mentions.cleanText || trimmed, controller.signal);
		const editorCtx = getEditorChatContext();
		const alwaysOn = await getAlwaysOnWorkspaceContext();
		const mergedContext = [editorCtx, alwaysOn, mentions.contextText, bangs.contextText].filter(Boolean).join('\n\n') || undefined;
		const llmUserText = bangs.cleanText || mentions.cleanText || trimmed;
		let turnOk = false;

		const stillActive = () => rt.clearSeq === clearSeqAtStart;

		const onRetry = (info: { attempt: number; maxAttempts: number; status?: number; delayMs: number }) => {
			rt.busyDetail = vscode.l10n.t(
				'chat.retrying',
				info.attempt,
				info.maxAttempts,
				info.status ?? '-',
			);
			this.emit();
		};

		const clearRetryStatus = () => {
			if (!rt.busyDetail) {
				return;
			}

			rt.busyDetail = undefined;
			this.emit();
		};

		try {
			if (isAgentLikeMode(settings.chatMode)) {
				await this.maybeAutoCompactBeforeTurn(controller.signal);
				const planReload = await this.reloadPlanForTurn();
				if (planReload.parseError) {
					this.append({
						id: messageId(),
						role: 'error',
						content: vscode.l10n.t('chat.error.planParse', planReload.parseError, this.planStore.relativePath),
					}, runSessionId);
				}
				await this.agent.run({
					history: rt.messages.slice(0, -1),
					userText: llmUserText,
					editorContext: mergedContext,
					attachments,
					signal: controller.signal,
					sessionId: runSessionId,
					confirm: (req) => this.requestConfirm(req, runSessionId),
					askQuestion: (req) => this.requestQuestion(req, runSessionId),
					revealFile: revealAgentFile,
					plan: this.stickyPlan,
					onPlanChanged: () => this.onPlanChanged(),
					checkpoint,
					writes: rt.writes,
					planEditsAppendix: planReload.planEditsAppendix,
					mode: settings.chatMode,
					sessionAllow: rt.sessionAllow,
					onAlwaysAllow: (pattern) => {
						if (pattern && !rt.sessionAllow.includes(pattern)) {
							rt.sessionAllow.push(pattern);
						}
					},
					onTodosChanged: (items) => {
						if (!stillActive()) {
							return;
						}

						rt.todos = items.map((item) => ({
							id: item.id,
							content: item.content,
							status: (item.status === 'in_progress' || item.status === 'completed' || item.status === 'cancelled'
								? item.status
								: 'pending') as ChatTodoItem['status'],
						}));
						this.emit();
					},
					setChatMode: (mode) => this.setMode(mode),
					onRetry,
					onPaused: (info) => {
						if (!stillActive()) {
							return;
						}

						rt.agentPaused = info;
						this.emit();
					},
					onToolStart: (id, ctrl) => {
						if (!stillActive()) {
							return;
						}

						rt.toolAborts.set(id, ctrl);
						rt.activeToolCallId = id;
						this.emit();
					},
					onToolEnd: (id) => {
						if (!stillActive()) {
							return;
						}

						rt.toolAborts.delete(id);
						if (rt.activeToolCallId === id) {
							rt.activeToolCallId = undefined;
						}

						this.emit();
					},
					onTurnDiff: ({ turnId, paths }) => {
						if (!stillActive()) {
							return;
						}

						rt.lastTurnDiff = paths.length > 0
							? {
								turnId,
								paths: [...paths],
								at: Date.now()
							}
							: undefined;
						this.emit();
						if (paths.length > 0) {
							void runSessionDiffHook(paths, turnId);
						}
					},
					ui: {
						append: (message) => {
							if (!stillActive()) {
								return;
							}
							this.append(message, runSessionId);
						},
						update: (id, patch) => {
							if (!stillActive()) {
								return;
							}
							if (typeof patch.content === 'string' && patch.content.length > 0) {
								clearRetryStatus();
							}
							this.update(id, patch, runSessionId);
						},
					},
				});
			} else {
				const assistantId = messageId();
				let streamed = '';
				let streamedThinking = '';
				this.append({
					id: assistantId,
					role: 'assistant',
					content: '',
				}, runSessionId);
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
				const rulesAppendix = rulesParts.length ? rulesParts.join('\n\n') : undefined;

				await this.maybeAutoCompactBeforeTurn(controller.signal, new Set([assistantId]));

				const buildAskMessages = () => buildChatCompletionMessages(
					rt.messages,
					llmUserText,
					mergedContext,
					rulesAppendix,
					attachments,
				);

				let askMessages = await buildAskMessages();
				const askSettings = getSettings();
				const result = await completeWithContextGuard({
					client: this.client,
					settings: askSettings,
					getMessages: () => askMessages,
					setMessages: (next) => {
						askMessages = next;
					},
					complete: (messages) => this.client.complete({
						messages,
						signal: controller.signal,
						onDelta: (chunk) => {
							if (!stillActive()) {
								return;
							}
							clearRetryStatus();
							streamed += chunk;
							this.update(assistantId, {
								content: streamed
							}, runSessionId);
						},
						onThinkingDelta: (chunk) => {
							if (!stillActive()) {
								return;
							}

							clearRetryStatus();
							streamedThinking += chunk;
							this.update(assistantId, {
								thinking: streamedThinking
							}, runSessionId);
						},
						onRetry,
					}),
					onStatus: (detail) => {
						rt.busyDetail = detail;
						this.emit();
					},
					signal: controller.signal,
				});
				if (stillActive()) {
					clearRetryStatus();
					this.update(assistantId, {
						content: result.content.trim() || streamed,
						thinking: (result.thinking || streamedThinking).trim() || undefined,
						usage: result.usage,
					}, runSessionId);
				}
			}
			turnOk = !controller.signal.aborted;
		} catch (err) {
			turnOk = false;
			if (!stillActive()) {
				return;
			}
			const cancelled = isAbortError(err) || controller.signal.aborted;
			this.append({
				id: messageId(),
				role: 'error',
				content: cancelled ? vscode.l10n.t('chat.error.cancelled') : err instanceof Error ? err.message : String(err),
			}, runSessionId);
		} finally {
			if (rt.inflight === controller) {
				rt.inflight = undefined;
			}
			rt.busyDetail = undefined;
			for (const ctrl of rt.toolAborts.values()) {
				ctrl.abort();
			}

			rt.toolAborts.clear();
			rt.activeToolCallId = undefined;
			rt.todos = [];
			if (stillActive()) {
				this.persist(runSessionId);
				this.emit();
			}
		}

		if (!stillActive()) {
			return;
		}

		const paused = Boolean(rt.agentPaused);

		if (turnOk && !paused) {
			await this.maybeRenameSessionAfterTurn(controller.signal, runSessionId, rt.messages);
		}

		if (snapshotEnabled && checkpoint.size > 0) {
			const restored = await offerCheckpointRestore(checkpoint);
			if (restored.length > 0) {
				rt.writes.clear();
				rt.lastCheckpoint = undefined;
				// Пользователь откатил файлы сразу - не держим checkpoint в undo
				const top = rt.undoStack[rt.undoStack.length - 1];
				if (top) {
					top.checkpoint = undefined;
				}
			} else {
				rt.lastCheckpoint = checkpoint;
				const top = rt.undoStack[rt.undoStack.length - 1];
				if (top) {
					top.checkpoint = checkpoint;
				}
			}
		}

		const usage = sumUsage(rt.messages);
		if (usage && usage.totalTokens > 0) {
			writeLog('agent', `[${new Date().toISOString()}] session tokens prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens}`);
		}

		this.notifyTurnComplete(controller.signal, paused);

		// При мягкой паузе ждём Continue/Stop - очередь не дренируем
		if (!paused) {
			await this.drainTurnQueue(runSessionId);
		}
	}

	// Продолжение после max_steps: history = messages вкладки, nudge в API без дубля user в UI
	private async runContinueTurn(): Promise<void> {
		const runSessionId = this.sessions.getCurrentSessionId();
		const rt = this.ensureRuntime(runSessionId);
		if (rt.inflight) {
			return;
		}

		if (!this.canStartConcurrentRun()) {
			this.notifyMaxConcurrentRuns();
			return;
		}

		const clearSeqAtStart = rt.clearSeq;
		const controller = new AbortController();
		rt.inflight = controller;
		rt.busyDetail = undefined;
		this.emit();

		const settings = getSettings();
		if (!settings.baseUrl.trim() || !(await this.ensureSessionModel())) {
			if (rt.inflight === controller) {
				rt.inflight = undefined;
			}

			this.append({
				id: messageId(),
				role: 'error',
				content: vscode.l10n.t('chat.error.missingUrlOrModel'),
			}, runSessionId);
			this.emit();
			return;
		}

		const snapshotEnabled = settings.snapshotEnabled !== false;
		const checkpoint = new AgentCheckpoint(snapshotEnabled);
		const nudge = '(продолжи с того места, где остановился - лимит итераций исчерпан)';
		let turnOk = false;
		const stillActive = () => rt.clearSeq === clearSeqAtStart;

		const onRetry = (info: { 
			attempt: number
			maxAttempts: number
			status?: number
			delayMs: number
		}) => {
			rt.busyDetail = vscode.l10n.t('chat.retrying', info.attempt, info.maxAttempts, info.status ?? '-');
			this.emit();
		};

		try {
			const planReload = await this.reloadPlanForTurn();
			if (planReload.parseError) {
				this.append({
					id: messageId(),
					role: 'error',
					content: vscode.l10n.t('chat.error.planParse', planReload.parseError, this.planStore.relativePath),
				}, runSessionId);
			}

			await this.agent.run({
				history: rt.messages,
				userText: nudge,
				signal: controller.signal,
				sessionId: runSessionId,
				confirm: (req) => this.requestConfirm(req, runSessionId),
				askQuestion: (req) => this.requestQuestion(req, runSessionId),
				revealFile: revealAgentFile,
				plan: this.stickyPlan,
				onPlanChanged: () => this.onPlanChanged(),
				checkpoint,
				writes: rt.writes,
				planEditsAppendix: planReload.planEditsAppendix,
				mode: settings.chatMode,
				sessionAllow: rt.sessionAllow,
				onAlwaysAllow: (pattern) => {
					if (pattern && !rt.sessionAllow.includes(pattern)) {
						rt.sessionAllow.push(pattern);
					}
				},
				onTodosChanged: (items) => {
					if (!stillActive()) {
						return;
					}

					rt.todos = items.map((item) => ({
						id: item.id,
						content: item.content,
						status: (item.status === 'in_progress' || item.status === 'completed' || item.status === 'cancelled'
							? item.status
							: 'pending') as ChatTodoItem['status'],
					}));
					this.emit();
				},
				setChatMode: (mode) => this.setMode(mode),
				onRetry,
				onPaused: (info) => {
					if (!stillActive()) {
						return;
					}

					rt.agentPaused = info;
					this.emit();
				},
				onToolStart: (id, ctrl) => {
					if (!stillActive()) {
						return;
					}

					rt.toolAborts.set(id, ctrl);
					rt.activeToolCallId = id;
					this.emit();
				},
				onToolEnd: (id) => {
					if (!stillActive()) {
						return;
					}

					rt.toolAborts.delete(id);
					if (rt.activeToolCallId === id) {
						rt.activeToolCallId = undefined;
					}

					this.emit();
				},
				onTurnDiff: ({ turnId, paths }) => {
					if (!stillActive()) {
						return;
					}

					rt.lastTurnDiff = paths.length > 0
						? { 
							turnId, 
							paths: [...paths], 
							at: Date.now() 
						}
						: undefined;
					this.emit();
					if (paths.length > 0) {
						void runSessionDiffHook(paths, turnId);
					}
				},
				ui: {
					append: (message) => {
						if (!stillActive()) {
							return;
						}
						this.append(message, runSessionId);
					},
					update: (id, patch) => {
						if (!stillActive()) {
							return;
						}
						this.update(id, patch, runSessionId);
					},
				},
			});
			turnOk = !controller.signal.aborted;
		} catch (err) {
			turnOk = false;
			if (!stillActive()) {
				return;
			}

			const cancelled = isAbortError(err) || controller.signal.aborted;
			this.append({
				id: messageId(),
				role: 'error',
				content: cancelled ? vscode.l10n.t('chat.error.cancelled') : err instanceof Error ? err.message : String(err),
			}, runSessionId);
		} finally {
			if (rt.inflight === controller) {
				rt.inflight = undefined;
			}

			rt.busyDetail = undefined;
			for (const ctrl of rt.toolAborts.values()) {
				ctrl.abort();
			}

			rt.toolAborts.clear();
			rt.activeToolCallId = undefined;
			rt.todos = [];
			if (stillActive()) {
				this.persist(runSessionId);
				this.emit();
			}
		}

		if (!stillActive()) {
			return;
		}

		const paused = Boolean(rt.agentPaused);

		if (snapshotEnabled && checkpoint.size > 0) {
			const restored = await offerCheckpointRestore(checkpoint);
			if (restored.length > 0) {
				rt.writes.clear();
			} else if (turnOk) {
				rt.lastCheckpoint = checkpoint;
			}
		}

		this.notifyTurnComplete(controller.signal, paused);

		if (!paused) {
			await this.drainTurnQueue(runSessionId);
		}
	}

	// После первого успешного хода: LLM-title на smallModel, если ещё «Новый чат»
	private async maybeRenameSessionAfterTurn(
		signal: AbortSignal,
		sessionId: string,
		messages: ChatUiMessage[],
	): Promise<void> {
		const session = this.sessions.getSession(sessionId);
		if (!session || !isDefaultSessionTitle(session.title)) {
			return;
		}

		const userTurns = messages.filter((m) => m.role === 'user').length;
		if (userTurns < 1) {
			return;
		}

		let title = await generateSessionTitle(messages, this.client, { signal });
		if (!title?.trim()) {
			title = fallbackTitleFromMessages(messages);
		}

		if (!title?.trim() || isDefaultSessionTitle(title)) {
			return;
		}

		if (this.sessions.renameSession(sessionId, title)) {
			this.emit();
		}
	}

	async exportSessionMarkdown(): Promise<void> {
		// Берём архив до compact - lossless история для export
		const source = this.exportArchive ?? this.messages;
		const fromArchive = Boolean(this.exportArchive);
		const lines = source.map((m) => {
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
		const header = fromArchive
			? '# Экспорт чата Gen\n\n_Экспорт полной истории до compact (архив сессии)._\n'
			: '# Экспорт чата Gen\n';
		const doc = await vscode.workspace.openTextDocument({
			content: `${header}\n${lines.join('\n\n')}\n`,
			language: 'markdown',
		});

		await vscode.window.showTextDocument(doc, { preview: false });
	}

	// Импорт markdown-экспорта (`# Экспорт чата Gen`) в новую сессию
	async importSessionMarkdown(): Promise<void> {
		const uris = await vscode.window.showOpenDialog({
			canSelectMany: false,
			filters: { Markdown: ['md'] },
		});
		if (!uris?.length) {
			return;
		}

		const uri = uris[0]!;
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const md = new TextDecoder().decode(bytes);
			const imported = parseExportedMarkdown(md);
			if (!imported.length) {
				void vscode.window.showWarningMessage(vscode.l10n.t('chat.import.empty'));
				return;
			}

			const firstUser = imported.find((m) => m.role === 'user');
			const firstLine = firstUser?.content.split('\n')
				.map((l) => l.trim())
				.find((l) => l);
			const fileBase = uri.path.split('/').pop()?.replace(/\.md$/i, '')?.trim();
			const title = (firstLine || fileBase || 'Import').slice(0, 120);

			if (!this.canCreateTab()) {
				this.notifyMaxTabs();
				return;
			}

			this.persist();
			const created = this.sessions.createSession(title);
			this.activateRuntime(created.id);
			this.messages = imported.slice(-MAX_STORED);
			this.persist();
			this.emit();
			void vscode.window.showInformationMessage(vscode.l10n.t('chat.import.done'));
		} catch (err) {
			void vscode.window.showErrorMessage(
				vscode.l10n.t('chat.import.failed', err instanceof Error ? err.message : String(err)),
			);
		}
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

		// Каталоги `.gen/{agents,commands,...}` - без перезаписи существующих файлов
		await ensureGenScaffold(folder.uri.fsPath);

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
				content: 'AGENTS.md уже есть. Каталоги `.gen/` проверены. Отредактируй AGENTS.md или добавь `.genrules` для правил Gen.',
			});
		} catch {
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(stub));
			this.append({
				id: messageId(),
				role: 'assistant',
				content: 'Создан AGENTS.md и каталоги `.gen/` (agents, commands, plugins, skills, tools, references, plans). Заполни правила проекта для агента.',
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
		await focusChatView();
		await this.send(block);
	}
}
