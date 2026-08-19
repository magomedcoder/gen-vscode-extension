import type { CommentStyle } from '../../../config/types';
import type { SettingsPageProps } from './pages';

export function CommentsPage({ draft, setField }: SettingsPageProps) {
	return (
		<>
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
		</>
	);
}
