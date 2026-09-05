import type { PersonaOption } from '../../../chat/protocol';
import type { AgentAuthLevel, ChatMode } from '../../../config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { parseNumberInput } from './parseNumber';

interface ChatAgentPageProps extends SettingsPageProps {
	personas?: PersonaOption[];
}

export function ChatAgentPage({ draft, setField, personas = [] }: ChatAgentPageProps) {
	const personaValue = draft.personaId && personas.some((p) => p.id === draft.personaId)
		? draft.personaId
		: '';

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
					<option value="plan">{t('settings.chatMode.plan')}</option>
					<option value="multitask">{t('settings.chatMode.multitask')}</option>
					<option value="debug">{t('settings.chatMode.debug')}</option>
					<option value="design">{t('settings.chatMode.design')}</option>
				</select>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.personaId.label')}</span>
				<select
					className="field__input"
					value={personaValue}
					onChange={(e) => setField('personaId', e.target.value)}
				>
					<option value="">{t('settings.personaId.none')}</option>
					{personas.map((p) => (
						<option key={p.id} value={p.id} title={p.description}>{p.name}</option>
					))}
				</select>
				<span className="field__hint">{t('settings.personaId.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.skillsPaths.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={3}
					value={draft.skillsPaths.join('\n')}
					onChange={(e) => setField('skillsPaths', e.target.value.split(/\r?\n/))}
					spellCheck={false}
				/>
				<span className="field__hint">{t('settings.skillsPaths.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.skillsUrls.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={3}
					value={draft.skillsUrls.join('\n')}
					onChange={(e) => setField('skillsUrls', e.target.value.split(/\r?\n/))}
					spellCheck={false}
				/>
				<span className="field__hint">{t('settings.skillsUrls.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.instructionUrls.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={3}
					value={draft.instructionUrls.join('\n')}
					onChange={(e) => setField('instructionUrls', e.target.value.split(/\r?\n/))}
					spellCheck={false}
				/>
				<span className="field__hint">{t('settings.instructionUrls.hint')}</span>
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
					checked={draft.formatAfterEdit}
					onChange={(e) => setField('formatAfterEdit', e.target.checked)}
				/>
				<span className="field__label">{t('settings.formatAfterEdit.label')}</span>
			</label>
			<span className="field__hint">{t('settings.formatAfterEdit.hint')}</span>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.alwaysOnWorkspaceContext}
					onChange={(e) => setField('alwaysOnWorkspaceContext', e.target.checked)}
				/>
				<span className="field__label">{t('settings.alwaysOnWorkspaceContext.label')}</span>
			</label>
			<span className="field__hint">{t('settings.alwaysOnWorkspaceContext.hint')}</span>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.notifyOnComplete}
					onChange={(e) => setField('notifyOnComplete', e.target.checked)}
				/>
				<span className="field__label">{t('settings.notifyOnComplete.label')}</span>
			</label>
			<span className="field__hint">{t('settings.notifyOnComplete.hint')}</span>

			<label className="field">
				<span className="field__label">{t('settings.subagentDepth.label')}</span>
				<input
					className="field__input"
					type="number"
					min={1}
					max={4}
					step={1}
					value={draft.subagentDepth}
					onChange={(e) => setField('subagentDepth', parseNumberInput(e.target.value, draft.subagentDepth))}
				/>
				<span className="field__hint">{t('settings.subagentDepth.hint')}</span>
			</label>
		</>
	);
}
