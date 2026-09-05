import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ConfirmCard } from './components/ConfirmCard';
import { MessageList } from './components/MessageList';
import { ProjectSetupBanner } from './components/ProjectSetupBanner';
import { SettingsScreen } from './components/SettingsScreen';
import { useGenBridge } from './useGenBridge';

export function App() {
	const {
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
	} = useGenBridge();

	if (screen === 'settings') {
		return (
			<SettingsScreen
				settings={settings}
				personas={personas}
				apiKeySet={apiKeySet}
				status={settingsStatus}
				models={models}
				modelsStatus={modelsStatus}
				modelsLoading={modelsLoading}
				mcpServers={mcpServers}
				onSave={saveSettings}
				onLoadModels={loadModels}
				onOpenLogsFolder={openLogsFolder}
				onRefreshMcp={refreshMcp}
			/>
		);
	}

	const confirming = Boolean(chat.pendingConfirm);

	return (
		<div className="app">
			<ChatHeader
				usage={chat.usage}
				maxContextTokens={chat.maxContextTokens}
				sessionId={chat.sessionId}
				sessions={chat.sessions}
			/>
			<ProjectSetupBanner project={chat.project} />
			<MessageList messages={chat.messages} busy={chat.busy} />
			{chat.pendingConfirm ? <ConfirmCard confirm={chat.pendingConfirm} /> : null}
			<div className="composer-dock">
				<Composer
					busy={chat.busy || confirming}
					busyDetail={chat.busy ? chat.busyDetail : undefined}
					queuedCount={chat.queuedCount ?? 0}
					mode={chat.mode}
					customSlashCommands={chat.customSlashCommands}
				/>
			</div>
		</div>
	);
}
