import { EXAMPLE_DENIED_COMMANDS, EXAMPLE_DENIED_PATHS, EXAMPLE_SECRET_PATTERNS } from '../../../config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';

export function SecurityPage({ draft, setField }: SettingsPageProps) {
	const setListField = (key: 'deniedPaths' | 'deniedCommands' | 'secretPatterns', text: string) => {
		setField(key, text.split(/\r?\n/));
	};

	return (
		<>
			<div className="field">
				<span className="field__label">{t('settings.deniedPaths.label')}</span>
				<textarea
					className="field__input field__input--multiline"
					rows={8}
					value={draft.deniedPaths.join('\n')}
					placeholder={EXAMPLE_DENIED_PATHS.join('\n')}
					spellCheck={false}
					onChange={(e) => setListField('deniedPaths', e.target.value)}
				/>
				<span className="field__hint">{t('settings.deniedPaths.hint')}</span>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => setField('deniedPaths', [...EXAMPLE_DENIED_PATHS])}
				>
					{t('settings.insertExamples')}
				</button>
			</div>

			<div className="field">
				<span className="field__label">{t('settings.deniedCommands.label')}</span>
				<textarea
					className="field__input field__input--multiline"
					rows={8}
					value={draft.deniedCommands.join('\n')}
					placeholder={EXAMPLE_DENIED_COMMANDS.join('\n')}
					spellCheck={false}
					onChange={(e) => setListField('deniedCommands', e.target.value)}
				/>
				<span className="field__hint">{t('settings.deniedCommands.hint')}</span>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => setField('deniedCommands', [...EXAMPLE_DENIED_COMMANDS])}
				>
					{t('settings.insertExamples')}
				</button>
			</div>

			<div className="field">
				<span className="field__label">{t('settings.secretPatterns.label')}</span>
				<textarea
					className="field__input field__input--multiline"
					rows={6}
					value={draft.secretPatterns.join('\n')}
					placeholder={EXAMPLE_SECRET_PATTERNS.join('\n')}
					spellCheck={false}
					onChange={(e) => setListField('secretPatterns', e.target.value)}
				/>
				<span className="field__hint">{t('settings.secretPatterns.hint')}</span>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => setField('secretPatterns', [...EXAMPLE_SECRET_PATTERNS])}
				>
					{t('settings.insertExamples')}
				</button>
			</div>
		</>
	);
}
