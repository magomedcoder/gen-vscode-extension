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

function readInitialScreen(): PanelScreen {
	return document.body.dataset.screen === 'settings' ? 'settings' : 'chat';
}

export function useGenBridge() {
	const [screen] = useState<PanelScreen>(readInitialScreen);
	const [chat, setChat] = useState<ChatViewState>(EMPTY_CHAT);
	const [settings, setSettings] = useState<GenSettings>(DEFAULT_SETTINGS);
	const [apiKeySet, setApiKeySet] = useState(false);
	const [settingsStatus, setSettingsStatus] = useState<string | undefined>();
	const [models, setModels] = useState<string[]>([]);
	const [modelsStatus, setModelsStatus] = useState<string | undefined>();
	const [modelsLoading, setModelsLoading] = useState(false);
	const modelsRequestId = useRef(0);

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
					setApiKeySet(data.apiKeySet);
					return;
				case 'settingsSaved':
					setSettings(data.settings);
					setApiKeySet(data.apiKeySet);
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
	}, []);

	const saveSettings = useCallback((next: GenSettings, api?: { apiKey?: string }) => {
		setSettingsStatus('Сохранение...');
		vscodeApi.postMessage({
			type: 'saveSettings',
			settings: next,
			apiKey: api?.apiKey,
		});
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
		setSettingsStatus(undefined);
		setModelsStatus('Загрузка моделей...');
		vscodeApi.postMessage({
			type: 'loadModels',
			baseUrl: trimmed,
			requestId,
		});
	}, []);

	const openLogsFolder = useCallback(() => {
		vscodeApi.postMessage({ type: 'openLogsFolder' });
	}, []);

	return {
		screen,
		chat,
		settings,
		apiKeySet,
		settingsStatus,
		models,
		modelsStatus,
		modelsLoading,
		saveSettings,
		loadModels,
		openLogsFolder,
	};
}
