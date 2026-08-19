import { useEffect, useState, type SubmitEvent } from 'react';
import type { GenSettings } from '../../config/types';
import { DEFAULT_SETTINGS } from '../../config/types';
import { ChatAgentPage } from './settings/ChatAgentPage';
import { CommentsPage } from './settings/CommentsPage';
import { ConnectionPage } from './settings/ConnectionPage';
import { LoggingPage } from './settings/LoggingPage';
import { SETTINGS_PAGES, type SettingsPageId } from './settings/pages';
import { RequestPage } from './settings/RequestPage';
import { SecurityPage } from './settings/SecurityPage';

interface SettingsScreenProps {
	settings: GenSettings;
	status?: string;
	apiKeySet: boolean;
	models: string[];
	modelsStatus?: string;
	modelsLoading: boolean;
	onSave: (settings: GenSettings, api?: { apiKey?: string }) => void;
	onLoadModels: (baseUrl: string) => void;
	onOpenLogsFolder: () => void;
}

export function SettingsScreen({
	settings,
	apiKeySet,
	status,
	models,
	modelsStatus,
	modelsLoading,
	onSave,
	onLoadModels,
	onOpenLogsFolder,
}: SettingsScreenProps) {
	const [page, setPage] = useState<SettingsPageId>('connection');
	const [draft, setDraft] = useState<GenSettings>(settings);
	const [apiKeyDraft, setApiKeyDraft] = useState('');

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
				model: models[0],
			};
		});
	}, [models]);

	const setField = <K extends keyof GenSettings>(key: K, value: GenSettings[K]) => {
		setDraft((prev) => ({ ...prev, [key]: value }));
	};

	const onReset = () => {
		const next: GenSettings = {
			...DEFAULT_SETTINGS,
			deniedPaths: [...DEFAULT_SETTINGS.deniedPaths],
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

	const current = SETTINGS_PAGES.find((item) => item.id === page) ?? SETTINGS_PAGES[0];

	return (
		<div className="app">
			<header className="header">
				<div className="header__left">
					<span className="header__title">Настройки</span>
					<span className="header__subtitle">{current.title}</span>
				</div>
				<button className="btn btn--secondary" type="button" onClick={onReset}>Сбросить по умолчанию</button>
			</header>

			<form className="settings-layout" onSubmit={onSubmit}>
				<nav className="settings-nav" aria-label="Разделы настроек">
					{SETTINGS_PAGES.map((item) => (
						<button
							key={item.id}
							type="button"
							className={`settings-nav__item${item.id === page ? ' settings-nav__item--active' : ''}`}
							onClick={() => setPage(item.id)}
						>
							<span className="settings-nav__title">{item.title}</span>
						</button>
					))}
				</nav>

				<div className="settings-main">
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
						{page === 'chat' ? <ChatAgentPage draft={draft} setField={setField} /> : null}
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
					</div>

					<div className="settings-footer">
						{status ? <div className="settings__status">{status}</div> : null}
						<button className="btn" type="submit">Сохранить</button>
					</div>
				</div>
			</form>
		</div>
	);
}
