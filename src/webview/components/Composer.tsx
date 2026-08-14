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

	return (
		<form className="composer" onSubmit={onSubmit}>
			<textarea
				className="composer__input"
				rows={2}
				value={draft}
				placeholder={busy ? 'Идёт запрос... можно набрать следующий' : 'Сообщение... Enter - отправить, Shift+Enter - строка'}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={onKeyDown}
			/>
			{busy ? (
				<button className="btn" type="button" onClick={() => vscodeApi.postMessage({ type: 'cancel' })}>Стоп</button>
			) : (
				<button className="btn" type="submit" disabled={!draft.trim()}>Отправить</button>
			)}
		</form>
	);
}
