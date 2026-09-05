import { useEffect, useMemo, useState, type SubmitEvent } from 'react';
import type { McpServerStatus, PersonaOption } from '../../chat/protocol';
import type { GenSettings } from '../../config/types';
import { DEFAULT_SETTINGS } from '../../config/types';
import type { LlmModelOption } from '../../llm/types';
import { t } from '../i18n';
import { ChatAgentPage } from './settings/ChatAgentPage';
import { CommentsPage } from './settings/CommentsPage';
import { ConnectionPage } from './settings/ConnectionPage';
import { LoggingPage } from './settings/LoggingPage';
import { McpPage } from './settings/McpPage';
import { SETTINGS_PAGE_IDS, SETTINGS_PAGE_KEYWORDS, settingsNavTitleKey } from './settings/pages';
import type { SettingsPageId } from './settings/pages';
import { RequestPage } from './settings/RequestPage';
import { SecurityPage } from './settings/SecurityPage';
import { UsagePage } from './settings/UsagePage';

interface SettingsScreenProps {
	settings: GenSettings;
	personas?: PersonaOption[];
	status?: string;
	apiKeySet: boolean;
	models: LlmModelOption[];
	modelsStatus?: string;
	modelsLoading: boolean;
	mcpServers?: McpServerStatus[];
	onSave: (settings: GenSettings, api?: { apiKey?: string }) => void;
	onLoadModels: (baseUrl: string) => void;
	onOpenLogsFolder: () => void;
	onRefreshMcp?: () => void;
}

function pageMatchesQuery(id: SettingsPageId, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) {
		return true;
	}

	const title = t(settingsNavTitleKey(id)).toLowerCase();
	if (title.includes(q)) {
		return true;
	}

	return SETTINGS_PAGE_KEYWORDS[id].some((kw) => kw.toLowerCase().includes(q) || q.includes(kw.toLowerCase()));
}

export function SettingsScreen({
	settings,
	personas = [],
	apiKeySet,
	status,
	models,
	modelsStatus,
	modelsLoading,
	mcpServers = [],
	onSave,
	onLoadModels,
	onOpenLogsFolder,
	onRefreshMcp,
}: SettingsScreenProps) {
	const [page, setPage] = useState<SettingsPageId>('connection');
	const [draft, setDraft] = useState<GenSettings>(settings);
	const [apiKeyDraft, setApiKeyDraft] = useState('');
	const [searchQuery, setSearchQuery] = useState('');

	useEffect(() => {
		setDraft(settings);
		setApiKeyDraft('');
		if (settings.baseUrl.trim()) {
			onLoadModels(settings.baseUrl);
		} else {
			onLoadModels('');
		}
	}, [settings, apiKeySet, onLoadModels]);

	useEffect(() => {
		if (models.length === 0) {
			return;
		}
		setDraft((prev) => {
			if (!prev.baseUrl.trim() || prev.model.trim()) {
				return prev;
			}

			return {
				...prev,
				model: models[0].id,
			};
		});
	}, [models]);

	const filteredPages = useMemo(
		() => SETTINGS_PAGE_IDS.filter((id) => pageMatchesQuery(id, searchQuery)),
		[searchQuery],
	);

	useEffect(() => {
		if (filteredPages.length === 0) {
			return;
		}

		if (!filteredPages.includes(page)) {
			setPage(filteredPages[0]);
		}
	}, [filteredPages, page]);

	const setField = <K extends keyof GenSettings>(key: K, value: GenSettings[K]) => {
		setDraft((prev) => ({ ...prev, [key]: value }));
	};

	const onReset = () => {
		const next: GenSettings = {
			...DEFAULT_SETTINGS,
			deniedPaths: [...DEFAULT_SETTINGS.deniedPaths],
			sensitivePathPatterns: [...DEFAULT_SETTINGS.sensitivePathPatterns],
			deniedCommands: [...DEFAULT_SETTINGS.deniedCommands],
			secretPatterns: [...DEFAULT_SETTINGS.secretPatterns],
		};
		setDraft(next);
		setApiKeyDraft('');
		onSave(next);
	};

	const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSave(draft, {
			apiKey: apiKeyDraft,
		});
	};

	const currentTitle = filteredPages.length > 0 ? t(settingsNavTitleKey(page)) : t('settings.search.empty');

	return (
		<div className="app">
			<header className="header">
				<div className="header__left">
					<span className="header__title">{t('settings.title')}</span>
					<span className="header__subtitle">{currentTitle}</span>
				</div>
				<button className="btn btn--secondary" type="button" onClick={onReset}>{t('settings.reset')}</button>
			</header>

			<form className="settings-layout" onSubmit={onSubmit}>
				<nav className="settings-nav" aria-label={t('settings.navAria')}>
					<input
						className="settings-nav__search"
						type="search"
						value={searchQuery}
						placeholder={t('settings.search.placeholder')}
						aria-label={t('settings.search.placeholder')}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
					{filteredPages.length === 0 ? (
						<div className="settings-nav__empty" role="status">{t('settings.search.empty')}</div>
					) : (
						filteredPages.map((id) => (
							<button
								key={id}
								type="button"
								className={`settings-nav__item${id === page ? ' settings-nav__item--active' : ''}`}
								onClick={() => setPage(id)}
							>
								<span className="settings-nav__title">{t(settingsNavTitleKey(id))}</span>
							</button>
						))
					)}
				</nav>

				<div className="settings-main">
					{filteredPages.length === 0 ? (
						<div className="settings settings--empty" role="status">{t('settings.search.empty')}</div>
					) : (
						<>
							<div className="settings">
								{page === 'connection' ? (
									<ConnectionPage
										draft={draft}
										setField={setField}
										apiKeySet={apiKeySet}
										apiKeyDraft={apiKeyDraft}
										models={models}
										modelsStatus={modelsStatus}
										modelsLoading={modelsLoading}
										onApiKeyDraft={setApiKeyDraft}
										onLoadModels={onLoadModels}
									/>
								) : null}
								{page === 'chat' ? <ChatAgentPage draft={draft} setField={setField} personas={personas} /> : null}
								{page === 'mcp' ? (
									<McpPage
										draft={draft}
										setField={setField}
										mcpServers={mcpServers}
										onRefreshMcp={onRefreshMcp}
									/>
								) : null}
								{page === 'request' ? <RequestPage draft={draft} setField={setField} /> : null}
								{page === 'comments' ? <CommentsPage draft={draft} setField={setField} /> : null}
								{page === 'security' ? <SecurityPage draft={draft} setField={setField} /> : null}
								{page === 'logging' ? (
									<LoggingPage
										draft={draft}
										setField={setField}
										onOpenLogsFolder={onOpenLogsFolder}
									/>
								) : null}
								{page === 'usage' ? <UsagePage draft={draft} setField={setField} /> : null}
							</div>

							<div className="settings-footer">
								{status ? <div className="settings__status">{status}</div> : null}
								<button className="btn" type="submit">{t('settings.save')}</button>
							</div>
						</>
					)}
				</div>
			</form>
		</div>
	);
}
