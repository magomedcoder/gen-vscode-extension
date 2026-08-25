import type { TokenUsage } from '../../llm/usage';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';
import { TokenMeter } from './TokenMeter';

interface ChatHeaderProps {
	usage?: TokenUsage;
}

export function ChatHeader({ usage }: ChatHeaderProps) {
	return (
		<header className="header">
			<div className="header__left">
				<span className="header__title">{t('chat.header.title')}</span>
			</div>
			<div className="header__actions">
				<TokenMeter usage={usage} compact />
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'openSettings' })}
				>
					{t('chat.header.settings')}
				</button>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'clear' })}
				>
					{t('chat.header.clear')}
				</button>
			</div>
		</header>
	);
}
