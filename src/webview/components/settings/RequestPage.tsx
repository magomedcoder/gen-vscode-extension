import type { SettingsPageProps } from './pages';
import { parseNumberInput } from './parseNumber';

export function RequestPage({ draft, setField }: SettingsPageProps) {
	return (
		<>
			<label className="field">
				<span className="field__label">Температура (лучше держать низкой для стабильного формата)</span>
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
				<span className="field__label">Максимум токенов в ответе модели</span>
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
				<span className="field__label">Таймаут (мс)</span>
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
				<span className="field__label">Максимальное количество символов на входе</span>
				<input
					className="field__input"
					type="number"
					min={500}
					step={100}
					value={draft.maxInputChars}
					onChange={(e) => setField('maxInputChars', parseNumberInput(e.target.value, draft.maxInputChars))}
				/>
			</label>
		</>
	);
}
