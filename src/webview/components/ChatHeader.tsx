import type { TokenUsage } from '../../llm/usage';
import { vscodeApi } from '../vscodeApi';
import { TokenMeter } from './TokenMeter';

interface ChatHeaderProps {
	usage?: TokenUsage;
}

export function ChatHeader({ usage }: ChatHeaderProps) {
	return (
		<header className="header">
			<div className="header__left">
				<span className="header__title">Чат</span>
			</div>
			<div className="header__actions">
				<TokenMeter usage={usage} compact />
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'openSettings' })}
				>
					Настройки
				</button>
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
