import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { MessageList } from './components/MessageList';
import { SettingsScreen } from './components/SettingsScreen';
import { useGenBridge } from './useGenBridge';

export function App() {
	const {
		screen,
		chat,
		settings,
		apiKeySet,
		settingsStatus,
		models,
		modelsStatus,
		modelsLoading,
		closeSettings,
		saveSettings,
		loadModels,
		openLogsFolder,
	} = useGenBridge();

	if (screen === 'settings') {
		return (
			<SettingsScreen
				settings={settings}
				apiKeySet={apiKeySet}
				status={settingsStatus}
				models={models}
				modelsStatus={modelsStatus}
				modelsLoading={modelsLoading}
				onBack={closeSettings}
				onSave={saveSettings}
				onLoadModels={loadModels}
				onOpenLogsFolder={openLogsFolder}
			/>
		);
	}

	return (
		<div className="app">
			<ChatHeader mode={chat.mode} busy={chat.busy} />
			<MessageList messages={chat.messages} busy={chat.busy} />
			<Composer busy={chat.busy} />
		</div>
	);
}
