import { EXAMPLE_DENIED_PATHS, EXAMPLE_SECRET_PATTERNS } from '../../../config/types';
import type { SettingsPageProps } from './pages';

export function SecurityPage({ draft, setField }: SettingsPageProps) {
	const setListField = (key: 'deniedPaths' | 'secretPatterns', text: string) => {
		setField(key, text.split(/\r?\n/));
	};

	return (
		<>
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
		</>
	);
}
