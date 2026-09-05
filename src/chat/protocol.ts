import type { ChatMode, GenSettings } from '../config/types';
import type { TokenUsage } from '../llm/usage';
import type { ConfirmChoice } from '../agent/types';
import type { DiffHunkPayload, HunkReviewStatus } from '../agent/diff';
import type { ModelUsage } from '../stores/usageStore';
import type { McpServerStatus } from '../integrations/mcpClient';
import type { SessionSummary } from './sessionStore';

export type { McpServerStatus } from '../integrations/mcpClient';
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
	// Картинки, сохранённые в `.gen/attachments/`
	attachments?: Array<{ path: string; mimeType: string }>;
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
	alwaysLabel?: string;
	suggestion?: string;
	allowAlways?: boolean;
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
	// Детали busy-состояния (например статус HTTP-retry)
	busyDetail?: string;
	// Сообщения в очереди, пока идёт текущий turn
	queuedCount: number;
	mode: ChatMode;
	usage?: TokenUsage;
	// Лимит контекста для context ring
	maxContextTokens?: number;
	sessionId?: string;
	sessions?: SessionSummary[];
	pendingConfirm?: PendingConfirm;
	project?: ChatProjectStatus;
	// Кастомные slash из `.gen/commands` для автодополнения Composer
	customSlashCommands?: Array<{ id: string; name: string; detail?: string; mode?: ChatMode }>;
}

export type ToWebviewMessage = | { type: 'state'; state: ChatViewState }
	| { type: 'settings'; settings: GenSettings; apiKeySet: boolean; personas?: PersonaOption[] }
	| { type: 'settingsSaved'; settings: GenSettings; apiKeySet: boolean; personas?: PersonaOption[] }
	| { type: 'settingsError'; message: string }
	| { type: 'models'; models: Array<{ id: string; label: string }>; requestId: number }
	| { type: 'modelsError'; message: string; requestId: number }
	| { type: 'mentionSuggestions'; requestId: number; items: MentionSuggestion[] }
	| { type: 'usageLedger'; ledger: Record<string, ModelUsage> }
	| { type: 'mcpStatus'; servers: McpServerStatus[] };

export interface PersonaOption {
	id: string;
	name: string;
	description: string;
}

export interface MentionSuggestion {
	kind: 'file' | 'folder' | 'codebase' | 'code' | 'git' | 'branch_diff' | 'rules' | 'link' | 'docs' | 'agent';
	label: string;
	insert: string;
	detail?: string;
}

export interface IncomingImagePayload {
	name: string;
	mimeType: string;
	base64: string;
}

export type FromWebviewMessage = | { type: 'ready' }
	| { type: 'send'; text: string; images?: IncomingImagePayload[] }
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
	| { type: 'reviewDiff'; toolCallId: string; action: 'acceptAll' | 'rejectAll' }
	| { type: 'newSession' }
	| { type: 'switchSession'; id: string }
	| { type: 'renameSession'; id: string; title: string }
	| { type: 'deleteSession'; id: string }
	| { type: 'forkSession'; messageId: string }
	| { type: 'loadUsage' }
	| { type: 'resetUsage' }
	| { type: 'refreshMcp' };
