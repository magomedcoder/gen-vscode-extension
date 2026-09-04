import { useEffect, useState } from 'react';
import type { AgentAuthLevel, ChatMode, GenSettings } from '../../../config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { parseNumberInput } from './parseNumber';

export function ChatAgentPage({ draft, setField }: SettingsPageProps) {
	const [mcpJson, setMcpJson] = useState(() => JSON.stringify(draft.mcpServers, null, 2));
	const [mcpError, setMcpError] = useState('');

	useEffect(() => {
		setMcpJson(JSON.stringify(draft.mcpServers, null, 2));
		setMcpError('');
	}, [draft.mcpServers]);

	const onMcpJsonChange = (raw: string) => {
		setMcpJson(raw);
		try {
			const parsed = JSON.parse(raw) as GenSettings['mcpServers'];
			if (!Array.isArray(parsed)) {
				setMcpError(t('settings.mcpServers.jsonArray'));
				return;
			}

			setMcpError('');
			setField('mcpServers', parsed);
		} catch {
			setMcpError(t('settings.mcpServers.invalidJson'));
		}
	};

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
					<option value="debug">{t('settings.chatMode.debug')}</option>
					<option value="design">{t('settings.chatMode.design')}</option>
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

			<label className="field">
				<span className="field__label">{t('settings.mcpServers.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={8}
					value={mcpJson}
					onChange={(e) => onMcpJsonChange(e.target.value)}
					spellCheck={false}
				/>
				<span className="field__hint">{t('settings.mcpServers.hint')}</span>
				{mcpError ? <span className="field__hint field__hint--error">{mcpError}</span> : null}
			</label>
		</>
	);
}
