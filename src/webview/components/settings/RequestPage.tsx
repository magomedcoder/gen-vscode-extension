import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { parseNumberInput } from './parseNumber';

export function RequestPage({ draft, setField }: SettingsPageProps) {
	return (
		<>
			<label className="field">
				<span className="field__label">{t('settings.temperature.label')}</span>
				<input
					className="field__input"
					type="number"
					min={0}
					max={2}
					step={0.1}
					value={draft.temperature}
					onChange={(e) => setField('temperature', parseNumberInput(e.target.value, draft.temperature))}
				/>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.maxTokens.label')}</span>
				<input
					className="field__input"
					type="number"
					min={64}
					step={1}
					value={draft.maxTokens}
					onChange={(e) => setField('maxTokens', parseNumberInput(e.target.value, draft.maxTokens))}
				/>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.maxContextTokens.label')}</span>
				<input
					className="field__input"
					type="number"
					min={1024}
					step={1024}
					value={draft.maxContextTokens}
					onChange={(e) => setField('maxContextTokens', parseNumberInput(e.target.value, draft.maxContextTokens))}
				/>
				<span className="field__hint">{t('settings.maxContextTokens.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.timeout.label')}</span>
				<input
					className="field__input"
					type="number"
					min={1000}
					step={1000}
					value={draft.requestTimeoutMs}
					onChange={(e) => setField('requestTimeoutMs', parseNumberInput(e.target.value, draft.requestTimeoutMs))}
				/>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.maxInputChars.label')}</span>
				<input
					className="field__input"
					type="number"
					min={500}
					step={100}
					value={draft.maxInputChars}
					onChange={(e) => setField('maxInputChars', parseNumberInput(e.target.value, draft.maxInputChars))}
				/>
			</label>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.visionEnabled}
					onChange={(e) => setField('visionEnabled', e.target.checked)}
				/>
				<span className="field__label">{t('settings.visionEnabled.label')}</span>
			</label>
			<span className="field__hint">{t('settings.visionEnabled.hint')}</span>

			<label className="field">
				<span className="field__label">{t('settings.attachmentImageMaxBase64.label')}</span>
				<input
					className="field__input"
					type="number"
					min={10000}
					step={10000}
					value={draft.attachmentImageMaxBase64}
					onChange={(e) => setField('attachmentImageMaxBase64', parseNumberInput(e.target.value, draft.attachmentImageMaxBase64))}
				/>
				<span className="field__hint">{t('settings.attachmentImageMaxBase64.hint')}</span>
			</label>
		</>
	);
}
