import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ConfirmCard } from './components/ConfirmCard';
import { MessageList } from './components/MessageList';
import { PlanCard } from './components/PlanCard';
import { ProjectSetupBanner } from './components/ProjectSetupBanner';
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
				onSave={saveSettings}
				onLoadModels={loadModels}
				onOpenLogsFolder={openLogsFolder}
			/>
		);
	}

	const confirming = Boolean(chat.pendingConfirm);

	return (
		<div className="app">
			<ChatHeader usage={chat.usage} />
			<ProjectSetupBanner project={chat.project} />
			<MessageList messages={chat.messages} busy={chat.busy} />
			{chat.pendingConfirm ? <ConfirmCard confirm={chat.pendingConfirm} /> : null}
			<div className="composer-dock">
				{chat.stickyPlan ? <PlanCard plan={chat.stickyPlan} /> : null}
				<Composer busy={chat.busy || confirming} mode={chat.mode} />
			</div>
		</div>
	);
}
