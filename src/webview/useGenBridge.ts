import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatViewState, McpServerStatus, PanelScreen, PersonaOption, ToWebviewMessage } from '../chat/protocol';
import type { GenSettings } from '../config/types';
import { DEFAULT_SETTINGS } from '../config/types';
import type { LlmModelOption } from '../llm/types';
import { t } from './i18n';
import { vscodeApi } from './vscodeApi';

const EMPTY_CHAT: ChatViewState = {
	messages: [],
	busy: false,
	queuedCount: 0,
	mode: 'ask',
};

function readInitialScreen(): PanelScreen {
	return document.body.dataset.screen === 'settings' ? 'settings' : 'chat';
}

export function useGenBridge() {
	const [screen] = useState<PanelScreen>(readInitialScreen);
	const [chat, setChat] = useState<ChatViewState>(EMPTY_CHAT);
	const [settings, setSettings] = useState<GenSettings>(DEFAULT_SETTINGS);
	const [personas, setPersonas] = useState<PersonaOption[]>([]);
	const [apiKeySet, setApiKeySet] = useState(false);
	const [settingsStatus, setSettingsStatus] = useState<string | undefined>();
	const [models, setModels] = useState<LlmModelOption[]>([]);
	const [modelsStatus, setModelsStatus] = useState<string | undefined>();
	const [modelsLoading, setModelsLoading] = useState(false);
	const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
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
					if (data.personas) {
						setPersonas(data.personas);
					}
					return;
				case 'settingsSaved':
					setSettings(data.settings);
					setApiKeySet(data.apiKeySet);
					if (data.personas) {
						setPersonas(data.personas);
					}
					setSettingsStatus(t('settings.status.saved'));
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
					setModelsStatus(
						data.models.length === 0
							? t('settings.models.empty')
							: t('settings.models.loaded', data.models.length),
					);
					if (data.models.length > 0) {
						setSettings((prev) => {
							if (prev.model && data.models.some((item) => item.id === prev.model)) {
								return prev;
							}

							return {
								...prev,
								model: data.models[0].id,
							};
						});
					}
					return;
				case 'modelsError':
					if (data.requestId !== modelsRequestId.current) {
						return;
					}
					setModelsLoading(false);
					setModelsStatus(data.message);
					return;
				case 'mcpStatus':
					setMcpServers(data.servers);
					return;
			}
		};

		window.addEventListener('message', onMessage);
		vscodeApi.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const saveSettings = useCallback((next: GenSettings, api?: { apiKey?: string }) => {
		setSettingsStatus(t('settings.status.saving'));
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
			setModelsStatus(t('settings.models.needUrl'));
			return;
		}

		const requestId = modelsRequestId.current + 1;
		modelsRequestId.current = requestId;
		setModelsLoading(true);
		setSettingsStatus(undefined);
		setModelsStatus(t('settings.models.loading'));
		vscodeApi.postMessage({
			type: 'loadModels',
			baseUrl: trimmed,
			requestId,
		});
	}, []);

	const openLogsFolder = useCallback(() => {
		vscodeApi.postMessage({ type: 'openLogsFolder' });
	}, []);

	const refreshMcp = useCallback(() => {
		vscodeApi.postMessage({ type: 'refreshMcp' });
	}, []);

	return {
		screen,
		chat,
		settings,
		personas,
		apiKeySet,
		settingsStatus,
		models,
		modelsStatus,
		modelsLoading,
		mcpServers,
		saveSettings,
		loadModels,
		openLogsFolder,
		refreshMcp,
	};
}
