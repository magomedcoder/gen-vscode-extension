import { useEffect, useMemo, useState } from 'react';
import type { McpServerStatus } from '../../../chat/protocol';
import type { GenSettings } from '../../../config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { SettingsSection } from './SettingsSection';

interface McpPageProps extends SettingsPageProps {
	mcpServers?: McpServerStatus[];
	onRefreshMcp?: () => void;
	onMcpOAuthAuth?: (serverName: string) => void;
	onMcpOAuthLogout?: (serverName: string) => void;
	onMcpOAuthDebug?: (serverName: string) => void;
}

function commandSummary(server: GenSettings['mcpServers'][number]): string {
	const parts = [server.command, ...(server.args ?? [])];
	return parts.filter(Boolean).join(' ');
}

export function McpPage({
	draft,
	setField,
	mcpServers = [],
	onRefreshMcp,
	onMcpOAuthAuth,
	onMcpOAuthLogout,
	onMcpOAuthDebug,
}: McpPageProps) {
	const [mcpJson, setMcpJson] = useState(() => JSON.stringify(draft.mcpServers, null, 2));
	const [mcpError, setMcpError] = useState('');
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	useEffect(() => {
		setMcpJson(JSON.stringify(draft.mcpServers, null, 2));
		setMcpError('');
	}, [draft.mcpServers]);

	const statusByName = useMemo(() => {
		const map = new Map<string, McpServerStatus>();
		for (const s of mcpServers) {
			map.set(s.name, s);
		}
		return map;
	}, [mcpServers]);

	const onMcpJsonChange = (raw: string) => {
		setMcpJson(raw);
		try {
			const parsed = JSON.parse(raw) as GenSettings['mcpServers'];
			if (!Array.isArray(parsed)) {
				setMcpError(t('settings.mcpServers.jsonArray'));
				return;
			}

			setMcpError('');
			setField('mcpServers', parsed);
		} catch {
			setMcpError(t('settings.mcpServers.invalidJson'));
		}
	};

	const setServerEnabled = (index: number, enabled: boolean) => {
		const next = draft.mcpServers.map((s, i) => (i === index ? { ...s, enabled } : s));
		setField('mcpServers', next);
	};

	const toggleTools = (name: string) => {
		setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
	};

	return (
		<>
			<SettingsSection titleKey="settings.section.mcp.servers" hintKey="settings.mcp.pageHint">
			<span className="field__hint">{t('settings.mcp.oauthHint')}</span>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.codeModeEnabled}
					onChange={(e) => setField('codeModeEnabled', e.target.checked)}
				/>
				<span className="field__label">{t('settings.codeModeEnabled.label')}</span>
			</label>
			<span className="field__hint field__hint--warning">{t('settings.codeModeEnabled.warning')}</span>

			<div className="settings__actions">
				<button className="btn btn--secondary" type="button" onClick={onRefreshMcp}>{t('settings.mcp.refresh')}</button>
			</div>

			{draft.mcpServers.length === 0 ? (
				<span className="field__hint">{t('settings.mcpServers.hint')}</span>
			) : (
				<div className="mcp-list">
					{draft.mcpServers.map((server, index) => {
						const live = statusByName.get(server.name);
						const toolsOpen = Boolean(expanded[server.name]);
						const oauthRequested = server.oauth === true || live?.oauthRequested === true;
						const oauthInfo = live?.oauth;
						let badgeClass = 'mcp-card__badge';
						let badgeText = t('settings.mcp.disconnected');
						if (!server.enabled) {
							badgeText = t('settings.mcp.disabled');
							badgeClass += ' mcp-card__badge--muted';
						} else if (live?.connected) {
							badgeText = t('settings.mcp.connected');
							badgeClass += ' mcp-card__badge--ok';
						} else if (live?.error) {
							badgeText = t('settings.mcp.error');
							badgeClass += ' mcp-card__badge--error';
						} else {
							badgeClass += ' mcp-card__badge--muted';
						}

						const tools = live?.tools ?? [];
						const toolCount = live?.toolCount ?? tools.length;

						return (
							<div key={`${server.name}-${index}`} className="mcp-card">
								<div className="mcp-card__header">
									<div className="mcp-card__title-row">
										<span className="mcp-card__name">{server.name || '-'}</span>
										<span className={badgeClass}>{badgeText}</span>
										{oauthRequested ? (
											<span
												className={`mcp-card__badge${oauthInfo?.hasToken ? ' mcp-card__badge--ok' : ' mcp-card__badge--muted'}`}
												title={t('settings.mcp.oauthHint')}
											>
												{oauthInfo?.hasToken
													? t('settings.mcp.oauthAuthed', oauthInfo.maskedPreview ?? '****')
													: t('settings.mcp.oauthNeeded')}
											</span>
										) : null}
									</div>
									<label className="field field--row mcp-card__enabled">
										<input
											type="checkbox"
											checked={Boolean(server.enabled)}
											onChange={(e) => setServerEnabled(index, e.target.checked)}
										/>
										<span className="field__label">{t('settings.mcp.enabled')}</span>
									</label>
								</div>
								<code className="mcp-card__command">{commandSummary(server) || '-'}</code>
								{live?.error ? (<span className="field__hint field__hint--error">{live.error}</span>) : null}
								{oauthRequested ? (
									<div className="mcp-card__oauth">
										<button
											type="button"
											className="btn btn--secondary"
											onClick={() => onMcpOAuthAuth?.(server.name)}
										>
											{t('settings.mcp.oauthAuth')}
										</button>
										<button
											type="button"
											className="btn btn--secondary"
											onClick={() => onMcpOAuthLogout?.(server.name)}
											disabled={!oauthInfo?.hasToken}
										>
											{t('settings.mcp.oauthLogout')}
										</button>
										<button
											type="button"
											className="btn btn--secondary"
											onClick={() => onMcpOAuthDebug?.(server.name)}
										>
											{t('settings.mcp.oauthDebug')}
										</button>
									</div>
								) : null}
								{server.enabled && toolCount > 0 ? (
									<>
										<button
											type="button"
											className="mcp-card__tools-toggle"
											onClick={() => toggleTools(server.name)}
										>
											{t('settings.mcp.tools')} ({toolCount})
											{toolsOpen ? ' ▾' : ' ▸'}
										</button>
										{toolsOpen ? (
											<ul className="mcp-card__tools">
												{tools.map((tool) => (
													<li key={tool.name} className="mcp-card__tool">
														<span className="mcp-card__tool-name">{tool.name}</span>
														{tool.description ? (<span className="mcp-card__tool-desc">{tool.description}</span>) : null}
													</li>
												))}
											</ul>
										) : null}
									</>
								) : null}
							</div>
						);
					})}
				</div>
			)}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.mcp.json" hintKey="settings.mcpServers.hint" defaultOpen={false}>
				<label className="field">
					<textarea
						className="field__input field__input--code"
						rows={12}
						value={mcpJson}
						onChange={(e) => onMcpJsonChange(e.target.value)}
						spellCheck={false}
					/>
					<span className="field__hint">{t('settings.mcp.oauthHint')}</span>
					{mcpError ? <span className="field__hint field__hint--error">{mcpError}</span> : null}
				</label>
			</SettingsSection>
		</>
	);
}
