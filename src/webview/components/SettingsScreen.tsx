import { useEffect, useState, type FormEvent } from 'react';
import type { CommentStyle, GenSettings } from '../../config/types';

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
	}, [settings]);

	useEffect(() => {
		if (settings.baseUrl.trim()) {
			onLoadModels(settings.baseUrl);
		}
	}, [settings.baseUrl, onLoadModels]);

	useEffect(() => {
		if (models.length === 0) {
			return;
		}

		if (!draft.model || !models.includes(draft.model)) {
			setDraft((prev) => ({
				...prev,
				model: models[0]
			}));
		}
	}, [models, draft.model]);

	const setField = <K extends keyof GenSettings>(key: K, value: GenSettings[K]) => {
		setDraft((prev) => ({ ...prev, [key]: value }));
	};

	const onSubmit = (event: FormEvent) => {
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
					<span className="field__label">Base URL</span>
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
								<option value="">{modelsLoading ? 'Загрузка...' : 'Нет моделей - укажите Base URL'}</option>
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
					<span className="field__label">Температура (лучше держать низкой для стабильного формата)</span>
					<input
						className="field__input"
						type="number"
						min={0}
						max={2}
						step={0.1}
						value={draft.temperature}
						onChange={(e) => setField('temperature', Number(e.target.value))}
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
						onChange={(e) => setField('maxTokens', Number(e.target.value))}
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
						onChange={(e) => setField('requestTimeoutMs', Number(e.target.value))}
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
						onChange={(e) => setField('maxInputChars', Number(e.target.value))}
					/>
				</label>

				<label className="field">
					<span className="field__label">Стиль комментариев</span>
					<select
						className="field__input"
						value={draft.commentStyle}
						onChange={(e) => setField('commentStyle', e.target.value as CommentStyle)}
					>
						<option value="inline">inline - короткие строковые комментарии</option>
						<option value="block">block - короткие блочные комментарии</option>
					</select>
				</label>

				<label className="field field--row">
					<input
						type="checkbox"
						checked={draft.previewBeforeApply}
						onChange={(e) => setField('previewBeforeApply', e.target.checked)}
					/>
					<span className="field__label">Diff перед применением комментариев</span>
				</label>

				{status ? <div className="settings__status">{status}</div> : null}

				<div className="settings__actions">
					<button className="btn" type="submit">Сохранить</button>
				</div>
			</form>
		</div>
	);
}
