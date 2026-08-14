import { useCallback, useEffect, useState } from 'react';
import type { GenSettings } from '../config/types';
import { DEFAULT_SETTINGS } from '../config/types';
import type { ChatViewState, PanelScreen, ToWebviewMessage } from '../chat/protocol';
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
			}
		};

		window.addEventListener('message', onMessage);
		vscodeApi.postMessage({
			type: 'ready'
		});
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const openSettings = useCallback(() => {
		setScreen('settings');
		setSettingsStatus(undefined);
		vscodeApi.postMessage({
			type: 'loadSettings'
		});
	}, []);

	const openChat = useCallback(() => {
		setScreen('chat');
		setSettingsStatus(undefined);
	}, []);

	const saveSettings = useCallback((next: GenSettings) => {
		setSettingsStatus('Сохранение...');
		vscodeApi.postMessage({
			type: 'saveSettings',
			settings: next
		});
	}, []);

	return {
		screen,
		chat,
		settings,
		settingsStatus,
		openSettings,
		openChat,
		saveSettings,
	};
}
