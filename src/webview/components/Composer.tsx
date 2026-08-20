import { useState, type KeyboardEvent, type SubmitEvent } from 'react';
import { vscodeApi } from '../vscodeApi';

interface ComposerProps {
	busy: boolean;
}

export function Composer({ busy }: ComposerProps) {
	const [draft, setDraft] = useState('');

	const submit = () => {
		const text = draft.trim();
		if (!text || busy) {
			return;
		}

		setDraft('');
		vscodeApi.postMessage({ type: 'send', text });
	};

	const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		submit();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	};

	const canSend = Boolean(draft.trim()) && !busy;

	return (
		<form className="composer" onSubmit={onSubmit}>
			<div className={`composer__box${busy ? ' composer__box--disabled' : ''}`}>
				<textarea
					className="composer__input"
					rows={2}
					value={draft}
					placeholder={busy ? 'Идёт запрос или подтверждение...' : 'Спросите Gen...'}
					disabled={busy}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={onKeyDown}
				/>
				<div className="composer__footer">
					<span className="composer__hint">
						{busy ? 'Ожидание...' : 'Enter - отправить, Shift+Enter - новая строка'}
					</span>
					{busy ? (
						<button className="btn btn--secondary composer__btn" type="button" onClick={() => vscodeApi.postMessage({ type: 'cancel' })}>Стоп</button>
					) : (
						<button className="btn composer__btn" type="submit" disabled={!canSend}>Отправить</button>
					)}
				</div>
			</div>
		</form>
	);
}
