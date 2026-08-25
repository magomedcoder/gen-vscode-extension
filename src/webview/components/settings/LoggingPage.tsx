import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';

interface LoggingPageProps extends SettingsPageProps {
	onOpenLogsFolder: () => void;
}

export function LoggingPage({ draft, setField, onOpenLogsFolder }: LoggingPageProps) {
	return (
		<>
			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.loggingEnabled}
					onChange={(e) => setField('loggingEnabled', e.target.checked)}
				/>
				<span className="field__label">{t('settings.loggingEnabled.label')}</span>
			</label>
			<span className="field__hint">{t('settings.loggingEnabled.hint')}</span>
			<button className="btn btn--secondary" type="button" onClick={onOpenLogsFolder}>
				{t('settings.openLogsFolder')}
			</button>
		</>
	);
}
