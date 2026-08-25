import type { CommentStyle } from '../../../config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';

export function CommentsPage({ draft, setField }: SettingsPageProps) {
	return (
		<>
			<label className="field">
				<span className="field__label">{t('settings.commentStyle.label')}</span>
				<select
					className="field__input"
					value={draft.commentStyle}
					onChange={(e) => setField('commentStyle', e.target.value as CommentStyle)}
				>
					<option value="inline">{t('settings.commentStyle.inline')}</option>
					<option value="block">{t('settings.commentStyle.block')}</option>
				</select>
			</label>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.previewBeforeApply}
					onChange={(e) => setField('previewBeforeApply', e.target.checked)}
				/>
				<span className="field__label">{t('settings.previewBeforeApply.label')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.commentSystemPrompt.label')}</span>
				<textarea
					className="field__input field__input--multiline"
					rows={4}
					placeholder={t('settings.commentSystemPrompt.placeholder')}
					value={draft.commentSystemPrompt}
					onChange={(e) => setField('commentSystemPrompt', e.target.value)}
				/>
			</label>
		</>
	);
}
