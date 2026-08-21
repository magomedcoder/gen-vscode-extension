import { useState, type KeyboardEvent, type SubmitEvent } from 'react';
import type { ChatMode } from '../../chat/protocol';
import { vscodeApi } from '../vscodeApi';

interface ComposerProps {
	busy: boolean;
	mode: ChatMode;
}

export function Composer({ busy, mode }: ComposerProps) {
	const [draft, setDraft] = useState('');

	const setMode = (next: ChatMode) => {
		if (next === mode || busy) {
			return;
		}

		vscodeApi.postMessage({
			type: 'setChatMode',
			mode: next,
		});
	};

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
					placeholder={busy ? 'Идёт запрос...' : 'Сообщение... Enter - отправить, Shift+Enter - строка'}
					disabled={busy}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={onKeyDown}
				/>
				<div className="composer__footer">
					<div className="mode-toggle" role="group" aria-label="Режим чата">
						<button
							type="button"
							className={`mode-toggle__btn${mode === 'ask' ? ' mode-toggle__btn--active' : ''}`}
							disabled={busy}
							onClick={() => setMode('ask')}
						>
							Просто чат
						</button>
						<button
							type="button"
							className={`mode-toggle__btn${mode === 'agent' ? ' mode-toggle__btn--active' : ''}`}
							disabled={busy}
							onClick={() => setMode('agent')}
						>
							Агент
						</button>
					</div>
					{busy ? (
						<button
							className="btn btn--secondary composer__btn"
							type="button"
							onClick={() => vscodeApi.postMessage({ type: 'cancel' })}
						>
							Стоп
						</button>
					) : (
						<button className="btn composer__btn" type="submit" disabled={!canSend}>Отправить</button>
					)}
				</div>
			</div>
		</form>
	);
}
