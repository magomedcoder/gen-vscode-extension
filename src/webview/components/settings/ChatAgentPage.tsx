import type { AgentAuthLevel, ChatMode } from '../../../config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { parseNumberInput } from './parseNumber';

export function ChatAgentPage({ draft, setField }: SettingsPageProps) {
	return (
		<>
			<label className="field">
				<span className="field__label">{t('settings.chatMode.label')}</span>
				<select
					className="field__input"
					value={draft.chatMode}
					onChange={(e) => setField('chatMode', e.target.value as ChatMode)}
				>
					<option value="ask">{t('settings.chatMode.ask')}</option>
					<option value="agent">{t('settings.chatMode.agent')}</option>
				</select>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.agentMaxIterations.label')}</span>
				<input
					className="field__input"
					type="number"
					min={0}
					max={40}
					step={1}
					value={draft.agentMaxIterations}
					onChange={(e) => setField('agentMaxIterations', parseNumberInput(e.target.value, draft.agentMaxIterations))}
				/>
				<span className="field__hint">{t('settings.agentMaxIterations.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.agentAuthLevel.label')}</span>
				<select
					className="field__input"
					value={draft.agentAuthLevel}
					onChange={(e) => setField('agentAuthLevel', e.target.value as AgentAuthLevel)}
				>
					<option value="auto">{t('settings.agentAuthLevel.auto')}</option>
					<option value="ask">{t('settings.agentAuthLevel.ask')}</option>
					<option value="open">{t('settings.agentAuthLevel.open')}</option>
				</select>
			</label>
			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.planWriteToFile}
					onChange={(e) => setField('planWriteToFile', e.target.checked)}
				/>
				<span className="field__label">{t('settings.planWriteToFile.label')}</span>
			</label>
			<span className="field__hint">{t('settings.planWriteToFile.hint')}</span>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.showPlanCard}
					onChange={(e) => setField('showPlanCard', e.target.checked)}
				/>
				<span className="field__label">{t('settings.showPlanCard.label')}</span>
			</label>
			<span className="field__hint">{t('settings.showPlanCard.hint')}</span>
		</>
	);
}
