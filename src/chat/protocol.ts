import type { ChatMode, GenSettings } from '../config/types';
import type { TokenUsage } from '../llm/usage';

export type { ChatMode };
export type ChatRole = 'user' | 'assistant' | 'error' | 'tool';
export type PanelScreen = 'chat' | 'settings';
export type ToolCallStatus = 'pending' | 'ok' | 'error' | 'denied';

export interface ToolCallUi {
	id: string;
	name: string;
	arguments: string;
	status: ToolCallStatus;
	result?: string;
	path?: string;
	diff?: string;
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

export interface ChatViewState {
	messages: ChatUiMessage[];
	busy: boolean;
	mode: ChatMode;
	usage?: TokenUsage;
}

export type ToWebviewMessage = | { type: 'state'; state: ChatViewState }
	| { type: 'settings'; settings: GenSettings; apiKeySet: boolean }
	| { type: 'settingsSaved'; settings: GenSettings; apiKeySet: boolean }
	| { type: 'settingsError'; message: string }
	| { type: 'models'; models: string[]; requestId: number }
	| { type: 'modelsError'; message: string; requestId: number };

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
	| { type: 'openLogsFolder' };
