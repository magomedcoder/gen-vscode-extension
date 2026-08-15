import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatViewState, PanelScreen, ToWebviewMessage } from '../chat/protocol';
import type { GenSettings } from '../config/types';
import { DEFAULT_SETTINGS } from '../config/types';
import { vscodeApi } from './vscodeApi';

const EMPTY_CHAT: ChatViewState = {
	messages: [],
	busy: false,
	mode: 'ask',
};

export function useGenBridge() {
	const [screen, setScreen] = useState<PanelScreen>('chat');
	const [chat, setChat] = useState<ChatViewState>(EMPTY_CHAT);
	const [settings, setSettings] = useState<GenSettings>(DEFAULT_SETTINGS);
	const [settingsStatus, setSettingsStatus] = useState<string | undefined>();
	const [models, setModels] = useState<string[]>([]);
	const [modelsStatus, setModelsStatus] = useState<string | undefined>();
	const [modelsLoading, setModelsLoading] = useState(false);
	const modelsRequestId = useRef(0);

	const requestSettings = useCallback(() => {
		vscodeApi.postMessage({ type: 'loadSettings' });
	}, []);

	useEffect(() => {
		const onMessage = (event: MessageEvent<ToWebviewMessage>) => {
			const data = event.data;
			if (!data || typeof data !== 'object' || !('type' in data)) {
				return;
			}

			switch (data.type) {
				case 'state':
					setChat(data.state);
					return;
				case 'settings':
					setSettings(data.settings);
					return;
				case 'showScreen':
					setScreen(data.screen);
					if (data.screen === 'settings') {
						setSettingsStatus(undefined);
						setModelsStatus(undefined);
						requestSettings();
					}
					return;
				case 'settingsSaved':
					setSettings(data.settings);
					setSettingsStatus('Сохранено');
					return;
				case 'settingsError':
					setSettingsStatus(data.message);
					return;
				case 'models':
					if (data.requestId !== modelsRequestId.current) {
						return;
					}
					setModels(data.models);
					setModelsLoading(false);
					setModelsStatus(data.models.length === 0 ? 'Сервер не вернул моделей' : `Загружено: ${data.models.length}`);
					return;
				case 'modelsError':
					if (data.requestId !== modelsRequestId.current) {
						return;
					}
					setModelsLoading(false);
					setModelsStatus(data.message);
					return;
			}
		};

		window.addEventListener('message', onMessage);
		vscodeApi.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, [requestSettings]);

	const openSettings = useCallback(() => {
		setScreen('settings');
		setSettingsStatus(undefined);
		setModelsStatus(undefined);
		requestSettings();
	}, [requestSettings]);

	const openChat = useCallback(() => {
		setScreen('chat');
	}, []);

	const saveSettings = useCallback((next: GenSettings) => {
		setSettingsStatus('Сохранение...');
		vscodeApi.postMessage({ type: 'saveSettings', settings: next });
	}, []);

	const loadModels = useCallback((baseUrl: string) => {
		const trimmed = baseUrl.trim();
		if (!trimmed) {
			setModels([]);
			setModelsLoading(false);
			setModelsStatus('Укажите базовый URL');
			return;
		}

		const requestId = modelsRequestId.current + 1;
		modelsRequestId.current = requestId;
		setModelsLoading(true);
		setModelsStatus('Загрузка моделей...');
		vscodeApi.postMessage({
			type: 'loadModels',
			baseUrl: trimmed,
			requestId
		});
	}, []);

	return {
		screen,
		chat,
		settings,
		settingsStatus,
		models,
		modelsStatus,
		modelsLoading,
		openSettings,
		openChat,
		saveSettings,
		loadModels,
	};
}
