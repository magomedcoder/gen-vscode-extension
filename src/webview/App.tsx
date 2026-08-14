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
		openSettings,
		openChat,
		saveSettings,
	} = useGenBridge();

	if (screen === 'settings') {
		return (
			<SettingsScreen
				settings={settings}
				status={settingsStatus}
				onBack={openChat}
				onSave={saveSettings}
			/>
		);
	}

	return (
		<div className="app">
			<ChatHeader onOpenSettings={openSettings} />
			<MessageList messages={chat.messages} />
			<Composer busy={chat.busy} />
		</div>
	);
}
