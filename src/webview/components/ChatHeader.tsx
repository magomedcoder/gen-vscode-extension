import type { ChatMode } from '../../chat/protocol';
import { vscodeApi } from '../vscodeApi';

interface ChatHeaderProps {
	mode: ChatMode;
	busy: boolean;
	onOpenSettings: () => void;
}

export function ChatHeader({ mode, busy, onOpenSettings }: ChatHeaderProps) {
	const setMode = (next: ChatMode) => {
		if (next === mode || busy) {
			return;
		}

		vscodeApi.postMessage({
			type: 'setChatMode',
			mode: next
		});
	};

	return (
		<header className="header">
			<div className="header__left">
				<span className="header__title">Чат</span>
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
			</div>
			<div className="header__actions">
				<button className="btn btn--secondary" type="button" onClick={onOpenSettings}>Настройки</button>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'clear' })}
				>
					Очистить
				</button>
			</div>
		</header>
	);
}
