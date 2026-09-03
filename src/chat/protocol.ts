import type { ChatMode, GenSettings } from '../config/types';
import type { TokenUsage } from '../llm/usage';
import type { ConfirmChoice } from '../agent/types';
import type { DiffHunkPayload, HunkReviewStatus } from '../agent/diff';

export type { ChatMode, ConfirmChoice, DiffHunkPayload, HunkReviewStatus };
export type ChatRole = 'user' | 'assistant' | 'error' | 'tool';
export type PanelScreen = 'chat' | 'settings';
export type ToolCallStatus = 'pending' | 'ok' | 'error' | 'denied';
export type ConfirmVariant = 'agent' | 'binary';

export interface ToolCallUi {
	id: string;
	name: string;
	arguments: string;
	status: ToolCallStatus;
	result?: string;
	path?: string;
	diff?: string;
	hunks?: DiffHunkPayload[];
}

export interface ChatUiMessage {
	id: string;
	role: ChatRole;
	content: string;
	toolCalls?: ToolCallUi[];
	toolCallId?: string;
	toolName?: string;
	toolArgs?: string;
	toolStatus?: ToolCallStatus;
	usage?: TokenUsage;
}

export interface PendingConfirm {
	id: string;
	title: string;
	detail?: string;
	hint?: string;
	variant: ConfirmVariant;
	applyLabel: string;
	skipLabel: string;
	stopLabel: string;
	rejectLabel: string;
}

export interface ChatProjectStatus {
	hasWorkspace: boolean;
	enabled: boolean;
	indexing: boolean;
	ready: boolean;
	error?: string;
	fileCount?: number;
	chunkCount?: number;
}

export interface ChatViewState {
	messages: ChatUiMessage[];
	busy: boolean;
	// Сообщения в очереди, пока идёт текущий turn
	queuedCount: number;
	mode: ChatMode;
	usage?: TokenUsage;
	pendingConfirm?: PendingConfirm;
	project?: ChatProjectStatus;
}

export type ToWebviewMessage = | { type: 'state'; state: ChatViewState }
	| { type: 'settings'; settings: GenSettings; apiKeySet: boolean }
	| { type: 'settingsSaved'; settings: GenSettings; apiKeySet: boolean }
	| { type: 'settingsError'; message: string }
	| { type: 'models'; models: Array<{ id: string; label: string }>; requestId: number }
	| { type: 'modelsError'; message: string; requestId: number }
	| { type: 'mentionSuggestions'; requestId: number; items: MentionSuggestion[] };

export interface MentionSuggestion {
	kind: 'file' | 'folder' | 'codebase';
	label: string;
	insert: string;
	detail?: string;
}

export type FromWebviewMessage = | { type: 'ready' }
	| { type: 'send'; text: string }
	| { type: 'cancel' }
	| { type: 'clear' }
	| { type: 'setChatMode'; mode: ChatMode }
	| { type: 'openExternal'; url: string }
	| { type: 'openSettings' }
	| { type: 'closeSettings' }
	| { type: 'loadSettings' }
	| { type: 'saveSettings'; settings: GenSettings; apiKey?: string }
	| { type: 'loadModels'; baseUrl: string; requestId: number }
	| { type: 'openLogsFolder' }
	| { type: 'confirmChoice'; id: string; choice: ConfirmChoice }
	| { type: 'mentionSuggest'; requestId: number; query: string }
	| { type: 'enableProject' }
	| { type: 'editMessage'; id: string; content: string }
	| { type: 'reviewHunk'; toolCallId: string; hunkId: string; action: 'accept' | 'reject' }
	| { type: 'reviewDiff'; toolCallId: string; action: 'acceptAll' | 'rejectAll' };
