import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { FieldText, FieldToggle } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

interface LoggingPageProps extends SettingsPageProps {
	onOpenLogsFolder: () => void;
}

export function LoggingPage({ draft, setField, onOpenLogsFolder }: LoggingPageProps) {
	return (
		<>
			<SettingsSection titleKey="settings.section.logging.files" hintKey="settings.section.logging.filesHint">
				<FieldToggle
					labelKey="settings.loggingEnabled.label"
					hintKey="settings.loggingEnabled.hint"
					checked={draft.loggingEnabled}
					onChange={(v) => setField('loggingEnabled', v)}
				/>
				<div className="settings__actions">
					<button className="btn btn--secondary" type="button" onClick={onOpenLogsFolder}>
						{t('settings.openLogsFolder')}
					</button>
				</div>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.logging.otel" hintKey="settings.section.logging.otelHint" defaultOpen={false}>
				<FieldToggle
					labelKey="settings.otelEnabled.label"
					hintKey="settings.otelEnabled.hint"
					checked={draft.otelEnabled}
					onChange={(v) => setField('otelEnabled', v)}
				/>
				<FieldText
					labelKey="settings.otelEndpoint.label"
					hintKey="settings.otelEndpoint.hint"
					value={draft.otelEndpoint}
					placeholder={t('settings.otelEndpoint.placeholder')}
					onChange={(v) => setField('otelEndpoint', v)}
					disabled={!draft.otelEnabled}
				/>
			</SettingsSection>
		</>
	);
}
