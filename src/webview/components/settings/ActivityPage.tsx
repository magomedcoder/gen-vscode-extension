import { useEffect, useState } from 'react';
import type { ActivityEntry } from '../../../core/stores/activityStore';
import { t } from '../../i18n';
import { vscodeApi } from '../../vscodeApi';
import type { SettingsPageProps } from './pages';
import { SettingsSection } from './SettingsSection';

function formatTs(ms: number): string {
	if (!ms) {
		return '-';
	}

	try {
		return new Date(ms).toLocaleString();
	} catch {
		return String(ms);
	}
}

function kindLabel(kind: ActivityEntry['kind']): string {
	switch (kind) {
		case 'edit':
			return t('settings.activity.kind.edit');
		case 'shell':
			return t('settings.activity.kind.shell');
		case 'mcp':
			return t('settings.activity.kind.mcp');
		case 'review':
			return t('settings.activity.kind.review');
		default:
			return t('settings.activity.kind.tool');
	}
}

export function ActivityPage(_props: SettingsPageProps) {
	const [entries, setEntries] = useState<ActivityEntry[]>([]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const data = event.data;
			if (data?.type === 'activityLedger' && Array.isArray(data.entries)) {
				setEntries(data.entries as ActivityEntry[]);
			}
		};

		window.addEventListener('message', onMessage);
		vscodeApi.postMessage({ type: 'loadActivity' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	return (
		<SettingsSection titleKey="settings.section.activity" hintKey="settings.activity.hint">
			{entries.length === 0 ? (
				<span className="field__hint">{t('settings.activity.empty')}</span>
			) : (
				<ul className="activity-list" aria-label={t('settings.activity.title')}>
					{entries.map((entry) => (
						<li key={entry.id} className="activity-list__item">
							<div className="activity-list__meta">
								<span className={`activity-list__kind activity-list__kind--${entry.kind}`}>{kindLabel(entry.kind)}</span>
								<span className="activity-list__time">{formatTs(entry.at)}</span>
								{entry.status ? (
									<span className="activity-list__status">{entry.status}</span>
								) : null}
							</div>
							<div className="activity-list__label">{entry.label}</div>
							{entry.path ? (
								<div className="activity-list__path">{entry.path}</div>
							) : null}
						</li>
					))}
				</ul>
			)}
			<div className="field__row" style={{ gap: 8 }}>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'loadActivity' })}
				>
					{t('settings.activity.refresh')}
				</button>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'clearActivity' })}
				>
					{t('settings.activity.clear')}
				</button>
			</div>
		</SettingsSection>
	);
}
