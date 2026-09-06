import type { ProviderUsePolicy } from '../../../core/config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { FieldSelect, FieldToggle } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

const PROVIDER_USE_POLICIES: ProviderUsePolicy[] = ['allow', 'deny'];

export function SecurityPage({ draft, setField }: SettingsPageProps) {
	return (
		<>
			<SettingsSection titleKey="settings.section.security.basics" hintKey="settings.section.security.basicsHint">
				<FieldToggle
					labelKey="settings.autoApprove.label"
					hintKey="settings.autoApprove.hint"
					checked={draft.autoApprove}
					onChange={(v) => setField('autoApprove', v)}
				/>
				<FieldToggle
					labelKey="settings.continueLoopOnDeny.label"
					hintKey="settings.continueLoopOnDeny.hint"
					checked={draft.continueLoopOnDeny}
					onChange={(v) => setField('continueLoopOnDeny', v)}
				/>
				<FieldToggle
					labelKey="settings.enableFileReading.label"
					checked={draft.enableFileReading}
					onChange={(v) => setField('enableFileReading', v)}
				/>
				<FieldToggle
					labelKey="settings.enableTerminal.label"
					checked={draft.enableTerminal}
					onChange={(v) => setField('enableTerminal', v)}
				/>
				<FieldToggle
					labelKey="settings.webSearchEnabled.label"
					checked={draft.webSearchEnabled}
					onChange={(v) => setField('webSearchEnabled', v)}
				/>
				<FieldToggle
					labelKey="settings.webFetchEnabled.label"
					checked={draft.webFetchEnabled}
					onChange={(v) => setField('webFetchEnabled', v)}
				/>
				<FieldToggle
					labelKey="settings.enableWorkspaceContext.label"
					checked={draft.enableWorkspaceContext}
					onChange={(v) => setField('enableWorkspaceContext', v)}
				/>
				<FieldToggle
					labelKey="settings.allowExternalDirectory.label"
					hintKey="settings.allowExternalDirectory.hint"
					checked={draft.allowExternalDirectory}
					onChange={(v) => setField('allowExternalDirectory', v)}
				/>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.security.provider" hintKey="settings.providerUse.hint" defaultOpen={false}>
				<FieldSelect
					labelKey="settings.providerUse.policy"
					value={draft.providerUsePolicy}
					onChange={(v) => setField('providerUsePolicy', v as ProviderUsePolicy)}
				>
					{PROVIDER_USE_POLICIES.map((mode) => (
						<option key={mode} value={mode}>{mode}</option>
					))}
				</FieldSelect>
				<label className="field">
					<span className="field__label">{t('settings.providerUse.patterns')}</span>
					<textarea
						className="field__input field__input--multiline"
						rows={3}
						value={draft.providerUsePatterns.join('\n')}
						placeholder={'api.openai.com\n*-prod\nlocal-*'}
						spellCheck={false}
						onChange={(e) => setField('providerUsePatterns', e.target.value.split(/\r?\n/))}
					/>
					<span className="field__hint">{t('settings.providerUse.patternsHint')}</span>
				</label>
			</SettingsSection>
		</>
	);
}
