import { useCallback, useState } from 'react';
import type { ThinkingDisplay } from '../core/config/types';
import { ChatHeader } from './components/ChatHeader';
import { Composer } from './components/Composer';
import { ConfirmCard } from './components/ConfirmCard';
import { MessageList } from './components/MessageList';
import { PendingChangesBar } from './components/PendingChangesBar';
import { ProjectSetupBanner } from './components/ProjectSetupBanner';
import { QuestionCard } from './components/QuestionCard';
import { SettingsScreen } from './components/SettingsScreen';
import { TodoPanel } from './components/TodoPanel';
import { TurnDiffBanner } from './components/TurnDiffBanner';
import { t } from './i18n';
import { collectPendingChanges } from './pendingChanges';
import { useGenBridge } from './useGenBridge';
import { vscodeApi } from './vscodeApi';

const TOOL_DETAILS_STORAGE_KEY = 'gen.toolDetailsExpanded';
const THINKING_DISPLAY_STORAGE_KEY = 'gen.thinkingDisplay';

function readToolDetailsExpanded(): boolean {
	try {
		const raw = localStorage.getItem(TOOL_DETAILS_STORAGE_KEY);
		if (raw === null) {
			return true;
		}

		return raw === '1' || raw === 'true';
	} catch {
		return true;
	}
}

function writeToolDetailsExpanded(expanded: boolean): void {
	try {
		localStorage.setItem(TOOL_DETAILS_STORAGE_KEY, expanded ? '1' : '0');
	} catch {}
}

function normalizeThinkingDisplay(raw: unknown): ThinkingDisplay {
	const value = String(raw ?? '');
	if (value === 'off' || value === 'expanded') {
		return value;
	}

	return 'collapsed';
}

function readThinkingDisplay(fallback: ThinkingDisplay): ThinkingDisplay {
	try {
		const raw = localStorage.getItem(THINKING_DISPLAY_STORAGE_KEY);
		if (raw === null) {
			return fallback;
		}

		return normalizeThinkingDisplay(raw);
	} catch {
		return fallback;
	}
}

function writeThinkingDisplay(mode: ThinkingDisplay): void {
	try {
		localStorage.setItem(THINKING_DISPLAY_STORAGE_KEY, mode);
	} catch {}
}

function nextThinkingDisplay(current: ThinkingDisplay): ThinkingDisplay {
	if (current === 'off') {
		return 'collapsed';
	}

	if (current === 'collapsed') {
		return 'expanded';
	}

	return 'off';
}

export function App() {
	const {
		screen,
		chat,
		settings,
		personas,
		adminPolicy,
		apiKeySet,
		settingsStatus,
		models,
		modelsStatus,
		modelsLoading,
		mcpServers,
		indexStatus,
		hooks,
		hooksStatus,
		externalHooks,
		agents,
		agentsStatus,
		rulesSkills,
		saveSettings,
		loadModels,
		openLogsFolder,
		refreshMcp,
		mcpOAuthAuth,
		mcpOAuthLogout,
		mcpOAuthDebug,
		loadIndexStatus,
		loadHooks,
		saveHooks,
		openHooksFile,
		loadExternalHooks,
		openExternalHookFile,
		importExternalHooks,
		loadAgents,
		cloneAgentPreset,
		loadRulesSkills,
		loadPersonas,
		openProjectPath,
	} = useGenBridge();

	const [toolDetailsExpanded, setToolDetailsExpanded] = useState(readToolDetailsExpanded);
	const toggleToolDetails = useCallback(() => {
		setToolDetailsExpanded((prev) => {
			const next = !prev;
			writeToolDetailsExpanded(next);
			return next;
		});
	}, []);

	const [thinkingDisplay, setThinkingDisplay] = useState<ThinkingDisplay>(() =>
		readThinkingDisplay(normalizeThinkingDisplay(settings.thinkingDisplay)));
	const cycleThinkingDisplay = useCallback(() => {
		setThinkingDisplay((prev) => {
			const next = nextThinkingDisplay(prev);
			writeThinkingDisplay(next);
			return next;
		});
	}, []);

	// Подгрузить модели для компактного picker в шапке чата
	const handleLoadChatModels = useCallback(() => {
		const baseUrl = settings.baseUrl.trim();
		if (baseUrl) {
			loadModels(baseUrl);
		}
	}, [settings.baseUrl, loadModels]);

	if (screen === 'settings') {
		return (
			<SettingsScreen
				settings={settings}
				personas={personas}
				adminPolicy={adminPolicy}
				apiKeySet={apiKeySet}
				status={settingsStatus}
				models={models}
				modelsStatus={modelsStatus}
				modelsLoading={modelsLoading}
				mcpServers={mcpServers}
				indexStatus={indexStatus}
				hooks={hooks}
				hooksStatus={hooksStatus}
				externalHooks={externalHooks}
				agents={agents}
				agentsStatus={agentsStatus}
				rulesSkills={rulesSkills}
				onSave={saveSettings}
				onLoadModels={loadModels}
				onOpenLogsFolder={openLogsFolder}
				onRefreshMcp={refreshMcp}
				onMcpOAuthAuth={mcpOAuthAuth}
				onMcpOAuthLogout={mcpOAuthLogout}
				onMcpOAuthDebug={mcpOAuthDebug}
				onLoadIndexStatus={loadIndexStatus}
				onLoadHooks={loadHooks}
				onSaveHooks={saveHooks}
				onOpenHooksFile={openHooksFile}
				onLoadExternalHooks={loadExternalHooks}
				onOpenExternalHookFile={openExternalHookFile}
				onImportExternalHooks={importExternalHooks}
				onLoadAgents={loadAgents}
				onCloneAgentPreset={cloneAgentPreset}
				onLoadRulesSkills={loadRulesSkills}
				onLoadPersonas={loadPersonas}
				onOpenProjectPath={openProjectPath}
			/>
		);
	}

	const confirming = Boolean(chat.pendingConfirm) || Boolean(chat.pendingQuestion);
	const paused = chat.agentPaused;
	const pendingChanges = collectPendingChanges(chat.messages);
	const showPendingBar = pendingChanges.hunkCount > 0 && !chat.busy && !confirming;
	const textSize = chat.chatTextSize ?? 'default';
	const appClass = textSize === 'default' ? 'app' : `app app--text-${textSize}`;

	return (
		<div className={appClass}>
			<ChatHeader
				usage={chat.usage}
				maxContextTokens={chat.maxContextTokens}
				sessionId={chat.sessionId}
				sessions={chat.sessions}
				toolDetailsExpanded={toolDetailsExpanded}
				onToggleToolDetails={toggleToolDetails}
				thinkingDisplay={thinkingDisplay}
				onCycleThinkingDisplay={cycleThinkingDisplay}
				models={models}
				model={chat.model}
				modelsLoading={modelsLoading}
				onLoadModels={handleLoadChatModels}
			/>
			<ProjectSetupBanner project={chat.project} />
			{chat.todos && chat.todos.length > 0 ? <TodoPanel todos={chat.todos} /> : null}
			<MessageList
				messages={chat.messages}
				busy={chat.busy}
				detailsExpanded={toolDetailsExpanded}
				thinkingDisplay={thinkingDisplay}
			/>
			{paused ? (
				<div className="pause-banner" role="status">
					<span className="pause-banner__text">
						{t('chat.pause.maxSteps', paused.iterations)}
					</span>
					<span className="pause-banner__actions">
						<button
							type="button"
							className="btn"
							onClick={() => vscodeApi.postMessage({ type: 'continueAgent' })}
						>
							{t('chat.pause.continue')}
						</button>
						<button
							type="button"
							className="btn btn--secondary"
							onClick={() => vscodeApi.postMessage({ type: 'stopAgentPause' })}
						>
							{t('chat.pause.stop')}
						</button>
					</span>
				</div>
			) : null}
			{!paused && chat.planHandoff ? (
				<div className="pause-banner" role="status">
					<span className="pause-banner__text">
						{chat.planHandoff.title
							? `${t('chat.planHandoff.title')}: ${chat.planHandoff.title}`
							: t('chat.planHandoff.title')}
					</span>
					<span className="pause-banner__actions">
						<button
							type="button"
							className="btn"
							onClick={() => vscodeApi.postMessage({ type: 'setChatMode', mode: 'agent' })}
						>
							{t('chat.planHandoff.run')}
						</button>
						<button
							type="button"
							className="btn btn--secondary"
							onClick={() => vscodeApi.postMessage({ type: 'dismissPlanHandoff' })}
						>
							{t('chat.planHandoff.dismiss')}
						</button>
					</span>
				</div>
			) : null}
			{chat.pendingConfirm ? <ConfirmCard confirm={chat.pendingConfirm} /> : null}
			{chat.pendingQuestion ? <QuestionCard question={chat.pendingQuestion} /> : null}
			<div className="composer-dock">
				{showPendingBar ? <PendingChangesBar summary={pendingChanges} /> : null}
				{chat.lastTurnDiff && chat.lastTurnDiff.paths.length > 0 ? (
					<TurnDiffBanner diff={chat.lastTurnDiff} />
				) : null}
				<Composer
					key={chat.sessionId ?? 'none'}
					busy={chat.busy || confirming}
					busyDetail={chat.busy ? chat.busyDetail : undefined}
					queuedCount={chat.queuedCount ?? 0}
					mode={chat.mode}
					sessionId={chat.sessionId}
					composerDraft={chat.composerDraft}
					composerChips={chat.composerChips}
					customSlashCommands={chat.customSlashCommands}
					imageResize={{
						attachmentImageAutoResize: settings.attachmentImageAutoResize,
						attachmentImageMaxWidth: settings.attachmentImageMaxWidth,
						attachmentImageMaxHeight: settings.attachmentImageMaxHeight,
					}}
				/>
			</div>
		</div>
	);
}
