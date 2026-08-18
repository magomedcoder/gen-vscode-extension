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
		settingsStatus,
		models,
		modelsStatus,
		modelsLoading,
		openSettings,
		openChat,
		saveSettings,
		loadModels,
	} = useGenBridge();

	if (screen === 'settings') {
		return (
			<SettingsScreen
				settings={settings}
				status={settingsStatus}
				models={models}
				modelsStatus={modelsStatus}
				modelsLoading={modelsLoading}
				onBack={openChat}
				onSave={saveSettings}
				onLoadModels={loadModels}
			/>
		);
	}

	return (
		<div className="app">
			<ChatHeader mode={chat.mode} busy={chat.busy} onOpenSettings={openSettings} />
			<MessageList messages={chat.messages} busy={chat.busy} />
			<Composer busy={chat.busy} />
		</div>
	);
}
