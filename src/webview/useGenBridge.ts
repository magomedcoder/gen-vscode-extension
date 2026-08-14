import { useCallback, useEffect, useState } from 'react';
import type { ChatViewState, PanelScreen, ToWebviewMessage } from '../chat/protocol';
import type { GenSettings } from '../config/types';
import { DEFAULT_SETTINGS } from '../config/types';
import { vscodeApi } from './vscodeApi';

const EMPTY_CHAT: ChatViewState = {
	messages: [],
	busy: false,
};

export function useGenBridge() {
	const [screen, setScreen] = useState<PanelScreen>('chat');
	const [chat, setChat] = useState<ChatViewState>(EMPTY_CHAT);
	const [settings, setSettings] = useState<GenSettings>(DEFAULT_SETTINGS);
	const [settingsStatus, setSettingsStatus] = useState<string | undefined>();
	const [models, setModels] = useState<string[]>([]);
	const [modelsStatus, setModelsStatus] = useState<string | undefined>();
	const [modelsLoading, setModelsLoading] = useState(false);

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
					setSettingsStatus(undefined);
					return;
				case 'showScreen':
					setScreen(data.screen);
					if (data.screen === 'settings') {
						vscodeApi.postMessage({
							type: 'loadSettings'
						});
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
					setModels(data.models);
					setModelsLoading(false);
					setModelsStatus(data.models.length === 0 ? 'Сервер не вернул моделей' : `Загружено: ${data.models.length}`);
					return;
				case 'modelsError':
					setModelsLoading(false);
					setModelsStatus(data.message);
					return;
			}
		};

		window.addEventListener('message', onMessage);
		vscodeApi.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const openSettings = useCallback(() => {
		setScreen('settings');
		setSettingsStatus(undefined);
		setModelsStatus(undefined);
		vscodeApi.postMessage({ type: 'loadSettings' });
	}, []);

	const openChat = useCallback(() => {
		setScreen('chat');
		setSettingsStatus(undefined);
	}, []);

	const saveSettings = useCallback((next: GenSettings) => {
		setSettingsStatus('Сохранение...');
		vscodeApi.postMessage({
			type: 'saveSettings',
			settings: next,
		});
	}, []);

	const loadModels = useCallback((baseUrl: string) => {
		setModelsLoading(true);
		setModelsStatus('Загрузка моделей...');
		vscodeApi.postMessage({
			type: 'loadModels',
			baseUrl,
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
