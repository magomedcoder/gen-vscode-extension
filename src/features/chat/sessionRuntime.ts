import { AgentCheckpoint } from '../agent/checkpoint';
import { AgentWriteTracker } from '../agent/userEdits';
import type { ConfirmChoice } from '../agent/types';
import type { ImageAttachment } from './attachments';
import type { AgentPausedState, ChatTodoItem, ChatUiMessage, PendingConfirm, PendingQuestion, SessionDiffEvent } from './protocol';

// Запись undo/redo одного user-хода
export interface TurnHistoryEntry {
	messages: ChatUiMessage[];
	checkpoint?: AgentCheckpoint;
}

export interface PendingConfirmInternal extends PendingConfirm {
	resolve: (choice: ConfirmChoice) => void;
}

export interface PendingQuestionInternal extends PendingQuestion {
	resolve: (answer: string) => void;
}

/**
 * Runtime одной чат-сессии (вкладки): очередь ходов, inflight, Accept/Reject, undo.
 * Хранится в Map - переключение вкладок не абортит чужие runs.
 */
export interface SessionRuntime {
	messages: ChatUiMessage[];
	inflight?: AbortController;
	busyDetail?: string;
	turnQueue: Array<{ text: string; attachments?: ImageAttachment[] }>;
	pendingConfirm?: PendingConfirmInternal;
	pendingQuestion?: PendingQuestionInternal;
	todos: ChatTodoItem[];
	agentPaused?: AgentPausedState;
	toolAborts: Map<string, AbortController>;
	activeToolCallId?: string;
	sessionAllow: string[];
	lastCheckpoint?: AgentCheckpoint;
	undoStack: TurnHistoryEntry[];
	redoStack: TurnHistoryEntry[];
	exportArchive?: ChatUiMessage[];
	lastTurnDiff?: SessionDiffEvent;
	writes: AgentWriteTracker;
	// Инкремент при clear/delete - колбэки старого run игнорируются
	clearSeq: number;
}

// Пустой runtime для новой или загруженной из store сессии
export function createSessionRuntime(messages: ChatUiMessage[] = []): SessionRuntime {
	return {
		messages: [...messages],
		turnQueue: [],
		todos: [],
		toolAborts: new Map(),
		sessionAllow: [],
		undoStack: [],
		redoStack: [],
		writes: new AgentWriteTracker(),
		clearSeq: 0,
	};
}

// Abort inflight + очистка очереди/confirm (без трогания messages)
export function abortSessionRuntime(rt: SessionRuntime): void {
	rt.clearSeq += 1;
	rt.turnQueue.length = 0;
	rt.inflight?.abort();
	rt.inflight = undefined;
	rt.busyDetail = undefined;
	for (const ctrl of rt.toolAborts.values()) {
		ctrl.abort();
	}
	
	rt.toolAborts.clear();
	rt.activeToolCallId = undefined;
	rt.agentPaused = undefined;
	if (rt.pendingConfirm) {
		const pending = rt.pendingConfirm;
		rt.pendingConfirm = undefined;
		pending.resolve('abort');
	}

	if (rt.pendingQuestion) {
		const pending = rt.pendingQuestion;
		rt.pendingQuestion = undefined;
		pending.resolve('');
	}

	rt.todos = [];
	rt.writes.clear();
	rt.sessionAllow.length = 0;
	rt.lastCheckpoint = undefined;
	rt.undoStack.length = 0;
	rt.redoStack.length = 0;
	rt.exportArchive = undefined;
	rt.lastTurnDiff = undefined;
}
