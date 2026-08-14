import type { GenSettings } from '../config/types';

export type ChatRole = 'user' | 'assistant' | 'error';
export type PanelScreen = 'chat' | 'settings';

export interface ChatUiMessage {
	id: string;
	role: ChatRole;
	content: string;
}

export interface ChatViewState {
	messages: ChatUiMessage[];
	busy: boolean;
}

export type ToWebviewMessage = | { type: 'state'; state: ChatViewState }
	| { type: 'settings'; settings: GenSettings }
	| { type: 'showScreen'; screen: PanelScreen }
	| { type: 'settingsSaved'; settings: GenSettings }
	| { type: 'settingsError'; message: string }
	| { type: 'models'; models: string[]; requestId: number }
	| { type: 'modelsError'; message: string; requestId: number };

export type FromWebviewMessage = | { type: 'ready' }
	| { type: 'send'; text: string }
	| { type: 'cancel' }
	| { type: 'clear' }
	| { type: 'openExternal'; url: string }
	| { type: 'loadSettings' }
	| { type: 'saveSettings'; settings: GenSettings }
	| { type: 'loadModels'; baseUrl: string; requestId: number };
