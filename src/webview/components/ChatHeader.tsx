import { vscodeApi } from '../vscodeApi';

interface ChatHeaderProps {
	onOpenSettings: () => void;
}

export function ChatHeader({ onOpenSettings }: ChatHeaderProps) {
	return (
		<header className="header">
			<span className="header__title">Чат</span>
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
