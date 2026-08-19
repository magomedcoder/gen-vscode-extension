import type { AgentAuthLevel, ChatMode } from '../../../config/types';
import type { SettingsPageProps } from './pages';
import { parseNumberInput } from './parseNumber';

export function ChatAgentPage({ draft, setField }: SettingsPageProps) {
	return (
		<>
			<label className="field">
				<span className="field__label">Режим чата по умолчанию</span>
				<select
					className="field__input"
					value={draft.chatMode}
					onChange={(e) => setField('chatMode', e.target.value as ChatMode)}
				>
					<option value="ask">Просто чат - только ответы текстом</option>
					<option value="agent">Агент - вызов инструмента</option>
				</select>
			</label>

			<label className="field">
				<span className="field__label">Лимит итераций агента</span>
				<input
					className="field__input"
					type="number"
					min={1}
					max={40}
					step={1}
					value={draft.agentMaxIterations}
					onChange={(e) => setField('agentMaxIterations', parseNumberInput(e.target.value, draft.agentMaxIterations))}
				/>
			</label>

			<label className="field">
				<span className="field__label">Уровень доступа агента</span>
				<select
					className="field__input"
					value={draft.agentAuthLevel}
					onChange={(e) => setField('agentAuthLevel', e.target.value as AgentAuthLevel)}
				>
					<option value="auto">Чтение - только просмотр файлов</option>
					<option value="ask">Спросить - подтверждать запись и удаление</option>
					<option value="open">Без спроса - без диалогов (всё в лог Gen Agent)</option>
				</select>
			</label>
		</>
	);
}
