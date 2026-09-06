import type { LlmModelOption } from '../../../core/llm/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { FieldText } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

interface ConnectionPageProps extends SettingsPageProps {
	apiKeySet: boolean;
	apiKeyDraft: string;
	models: LlmModelOption[];
	modelsStatus?: string;
	modelsLoading: boolean;
	onApiKeyDraft: (value: string) => void;
	onLoadModels: (baseUrl: string) => void;
}

export function ConnectionPage({
	draft,
	setField,
	apiKeySet,
	apiKeyDraft,
	models,
	modelsStatus,
	modelsLoading,
	onApiKeyDraft,
	onLoadModels,
}: ConnectionPageProps) {
	const modelOptions = draft.model && !models.some((item) => item.id === draft.model)
		? [{ id: draft.model, label: draft.model }, ...models]
		: models;

	return (
		<>
			<SettingsSection titleKey="settings.section.connection.main" hintKey="settings.section.connection.mainHint" defaultOpen>
				<FieldText
					labelKey="settings.baseUrl.label"
					hintKey="settings.baseUrl.hint"
					value={draft.baseUrl}
					onChange={(v) => setField('baseUrl', v)}
					onBlur={() => {
						if (draft.baseUrl.trim()) {
							onLoadModels(draft.baseUrl);
						}
					}}
				/>

				<FieldText
					labelKey="settings.apiKey.label"
					hintKey="settings.apiKey.hint"
					type="password"
					autoComplete="off"
					value={apiKeyDraft}
					placeholder={apiKeySet ? t('settings.apiKey.placeholderSet') : ''}
					onChange={onApiKeyDraft}
				/>

				<label className="field">
					<span className="field__label">{t('settings.model.label')}</span>
					<div className="field__row">
						<select
							className="field__input"
							value={draft.model}
							disabled={modelsLoading && modelOptions.length === 0}
							onChange={(e) => setField('model', e.target.value)}
						>
							{modelOptions.length === 0 ? (
								<option value="">{modelsLoading ? t('settings.model.loading') : t('settings.model.empty')}</option>
							) : (
								modelOptions.map((item) => (
									<option key={item.id} value={item.id} title={item.id}>
										{item.label}
									</option>
								))
							)}
						</select>
						<button
							className="btn btn--secondary"
							type="button"
							disabled={modelsLoading || !draft.baseUrl.trim()}
							onClick={() => onLoadModels(draft.baseUrl)}
						>
							{modelsLoading ? '...' : t('settings.model.refresh')}
						</button>
					</div>
					{modelsStatus ? <span className="field__hint">{modelsStatus}</span> : null}
				</label>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.connection.auth" hintKey="settings.section.connection.authHint" defaultOpen={false}>
				<FieldText
					labelKey="settings.authHeader.label"
					value={draft.authHeader}
					onChange={(v) => setField('authHeader', v)}
				/>
				<FieldText
					labelKey="settings.authScheme.label"
					hintKey="settings.authScheme.hint"
					value={draft.authScheme}
					onChange={(v) => setField('authScheme', v)}
				/>
			</SettingsSection>
		</>
	);
}
