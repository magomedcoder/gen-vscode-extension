import { useEffect, useState, type SubmitEvent } from 'react';
import { EXAMPLE_DENIED_PATHS, EXAMPLE_SECRET_PATTERNS } from '../../config/types';
import type { AgentAuthLevel, ChatMode, CommentStyle, GenSettings } from '../../config/types';

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

	const setListField = (key: 'deniedPaths' | 'secretPatterns', text: string) => {
		setField(key, text.split(/\r?\n/));
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

				<div className="field">
					<span className="field__label">Запрещённые пути агента</span>
					<textarea
						className="field__input field__input--multiline"
						rows={8}
						value={draft.deniedPaths.join('\n')}
						placeholder={EXAMPLE_DENIED_PATHS.join('\n')}
						spellCheck={false}
						onChange={(e) => setListField('deniedPaths', e.target.value)}
					/>
					<span className="field__hint">
						По одному glob на строку: .env, .env.*, *.pem, node_modules. 
						Пусто - не запрещать. 
						Строка с # - комментарий.
					</span>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => setField('deniedPaths', [...EXAMPLE_DENIED_PATHS])}
					>
						Вставить примеры
					</button>
				</div>

				<div className="field">
					<span className="field__label">Шаблоны секретов (regexp)</span>
					<textarea
						className="field__input field__input--multiline"
						rows={6}
						value={draft.secretPatterns.join('\n')}
						placeholder={EXAMPLE_SECRET_PATTERNS.join('\n')}
						spellCheck={false}
						onChange={(e) => setListField('secretPatterns', e.target.value)}
					/>
					<span className="field__hint">
						По одной JS-регулярке на строку. 
						Совпадения в ответах инструментов заменяются на [REDACTED]. 
						Пусто - не маскировать. Невалидная регулярка пропускается.
					</span>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => setField('secretPatterns', [...EXAMPLE_SECRET_PATTERNS])}
					>
						Вставить примеры
					</button>
				</div>

				{status ? <div className="settings__status">{status}</div> : null}

				<div className="settings__actions">
					<button className="btn" type="submit">Сохранить</button>
				</div>
			</form>
		</div>
	);
}
