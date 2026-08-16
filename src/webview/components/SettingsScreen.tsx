import { useEffect, useState, type SubmitEvent } from 'react';
import type { ChatMode, CommentStyle, GenSettings } from '../../config/types';

interface SettingsScreenProps {
	settings: GenSettings;
	status?: string;
	models: string[];
	modelsStatus?: string;
	modelsLoading: boolean;
	onBack: () => void;
	onSave: (settings: GenSettings) => void;
	onLoadModels: (baseUrl: string) => void;
}

function parseNumberInput(raw: string, fallback: number): number {
	if (!raw.trim()) {
		return fallback;
	}

	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

export function SettingsScreen({
	settings,
	status,
	models,
	modelsStatus,
	modelsLoading,
	onBack,
	onSave,
	onLoadModels,
}: SettingsScreenProps) {
	const [draft, setDraft] = useState<GenSettings>(settings);

	useEffect(() => {
		setDraft(settings);
		if (settings.baseUrl.trim()) {
			onLoadModels(settings.baseUrl);
		}
	}, [settings, onLoadModels]);

	useEffect(() => {
		if (models.length === 0) {
			return;
		}
		setDraft((prev) => {
			if (prev.model.trim()) {
				return prev;
			}

			return {
				...prev,
				model: models[0]
			};
		});
	}, [models]);

	const setField = <K extends keyof GenSettings>(key: K, value: GenSettings[K]) => {
		setDraft((prev) => ({ ...prev, [key]: value }));
	};

	const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSave(draft);
	};

	const modelOptions = draft.model && !models.includes(draft.model) ? [draft.model, ...models] : models;

	return (
		<div className="app">
			<header className="header">
				<span className="header__title">Настройки</span>
				<button className="btn btn--secondary" type="button" onClick={onBack}>
					К чату
				</button>
			</header>

			<form className="settings" onSubmit={onSubmit}>
				<label className="field">
					<span className="field__label">Базовый URL</span>
					<input
						className="field__input"
						value={draft.baseUrl}
						placeholder="http://localhost:8080"
						onChange={(e) => setField('baseUrl', e.target.value)}
						onBlur={() => {
							if (draft.baseUrl.trim()) {
								onLoadModels(draft.baseUrl);
							}
						}}
					/>
				</label>

				<label className="field">
					<span className="field__label">Модель</span>
					<div className="field__row">
						<select
							className="field__input"
							value={draft.model}
							disabled={modelsLoading && modelOptions.length === 0}
							onChange={(e) => setField('model', e.target.value)}
						>
							{modelOptions.length === 0 ? (
								<option value="">{modelsLoading ? 'Загрузка...' : 'Нет моделей - укажите базовый URL'}</option>
							) : (
								modelOptions.map((id) => (
									<option key={id} value={id}>{id}</option>
								))
							)}
						</select>
						<button
							className="btn btn--secondary"
							type="button"
							disabled={modelsLoading || !draft.baseUrl.trim()}
							onClick={() => onLoadModels(draft.baseUrl)}
						>
							{modelsLoading ? '...' : 'Обновить'}
						</button>
					</div>
					{modelsStatus ? <span className="field__hint">{modelsStatus}</span> : null}
				</label>

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

				<label className="field field--row">
					<input
						type="checkbox"
						checked={draft.agentConfirmWrites}
						onChange={(e) => setField('agentConfirmWrites', e.target.checked)}
					/>
					<span className="field__label">Спрашивать перед перезаписью файла и apply_patch (удаление - всегда)</span>
				</label>

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

				<label className="field">
					<span className="field__label">Стиль комментариев</span>
					<select
						className="field__input"
						value={draft.commentStyle}
						onChange={(e) => setField('commentStyle', e.target.value as CommentStyle)}
					>
						<option value="inline">строчные (inline)</option>
						<option value="block">блочные (block)</option>
					</select>
				</label>

				<label className="field field--row">
					<input
						type="checkbox"
						checked={draft.previewBeforeApply}
						onChange={(e) => setField('previewBeforeApply', e.target.checked)}
					/>
					<span className="field__label">Показывать diff перед применением комментариев</span>
				</label>

				{status ? <div className="settings__status">{status}</div> : null}

				<div className="settings__actions">
					<button className="btn" type="submit">Сохранить</button>
				</div>
			</form>
		</div>
	);
}
