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

			<label className="field">
				<span className="field__label">Дополнительный system prompt для комментариев</span>
				<textarea
					className="field__input field__input--multiline"
					rows={4}
					placeholder="Необязательно. Добавляется к стандартным инструкциям."
					value={draft.commentSystemPrompt}
					onChange={(e) => setField('commentSystemPrompt', e.target.value)}
				/>
			</label>
		</>
	);
}
