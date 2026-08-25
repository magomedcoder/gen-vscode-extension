import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';

interface ConnectionPageProps extends SettingsPageProps {
	apiKeySet: boolean;
	apiKeyDraft: string;
	models: string[];
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
	const modelOptions = draft.model && !models.includes(draft.model) ? [draft.model, ...models] : models;

	return (
		<>
			<label className="field">
				<span className="field__label">{t('settings.baseUrl.label')}</span>
				<input
					className="field__input"
					value={draft.baseUrl}
					onChange={(e) => setField('baseUrl', e.target.value)}
					onBlur={() => {
						if (draft.baseUrl.trim()) {
							onLoadModels(draft.baseUrl);
						}
					}}
				/>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.apiKey.label')}</span>
				<input
					className="field__input"
					type="password"
					autoComplete="off"
					value={apiKeyDraft}
					placeholder={apiKeySet ? t('settings.apiKey.placeholderSet') : ''}
					onChange={(e) => onApiKeyDraft(e.target.value)}
				/>
				<span className="field__hint">{t('settings.apiKey.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.authHeader.label')}</span>
				<input
					className="field__input"
					value={draft.authHeader}
					onChange={(e) => setField('authHeader', e.target.value)}
				/>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.authScheme.label')}</span>
				<input
					className="field__input"
					value={draft.authScheme}
					onChange={(e) => setField('authScheme', e.target.value)}
				/>
				<span className="field__hint">{t('settings.authScheme.hint')}</span>
			</label>

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
							modelOptions.map((id) => (<option key={id} value={id}>{id}</option>))
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
		</>
	);
}
