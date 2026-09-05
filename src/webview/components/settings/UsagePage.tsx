import { useEffect, useState } from 'react';
import type { ModelUsage } from '../../../stores/usageStore';
import { t } from '../../i18n';
import { vscodeApi } from '../../vscodeApi';
import type { SettingsPageProps } from './pages';

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

export function UsagePage(_props: SettingsPageProps) {
	const [ledger, setLedger] = useState<Record<string, ModelUsage>>({});

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const data = event.data;
			if (data?.type === 'usageLedger' && data.ledger && typeof data.ledger === 'object') {
				setLedger(data.ledger as Record<string, ModelUsage>);
			}
		};

		window.addEventListener('message', onMessage);
		vscodeApi.postMessage({ type: 'loadUsage' });
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const rows = Object.entries(ledger).sort((a, b) => (b[1].lastUsed || 0) - (a[1].lastUsed || 0));

	return (
		<>
			<span className="field__label">{t('settings.usage.title')}</span>
			<span className="field__hint">{t('settings.usage.hint')}</span>
			{rows.length === 0 ? (
				<span className="field__hint">{t('settings.usage.empty')}</span>
			) : (
				<table className="usage-table">
					<thead>
						<tr>
							<th>{t('settings.usage.model')}</th>
							<th>{t('settings.usage.prompt')}</th>
							<th>{t('settings.usage.completion')}</th>
							<th>{t('settings.usage.requests')}</th>
							<th>{t('settings.usage.lastUsed')}</th>
						</tr>
					</thead>
					<tbody>
						{rows.map(([model, row]) => (
							<tr key={model}>
								<td>{model}</td>
								<td>{row.promptTokens}</td>
								<td>{row.completionTokens}</td>
								<td>{row.requests}</td>
								<td>{formatTs(row.lastUsed)}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			<div className="field__row" style={{ marginTop: 8, gap: 8 }}>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'loadUsage' })}
				>
					{t('settings.usage.refresh')}
				</button>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'resetUsage' })}
				>
					{t('settings.usage.reset')}
				</button>
			</div>
		</>
	);
}
