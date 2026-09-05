import type { SessionSummary } from '../../chat/sessionStore';
import type { TokenUsage } from '../../llm/usage';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';
import { TokenMeter } from './TokenMeter';

interface ChatHeaderProps {
	usage?: TokenUsage;
	maxContextTokens?: number;
	sessionId?: string;
	sessions?: SessionSummary[];
}

export function ChatHeader({ usage, maxContextTokens, sessionId, sessions }: ChatHeaderProps) {
	const list = sessions ?? [];
	const currentId = sessionId ?? list[0]?.id ?? '';

	const onSwitch = (id: string) => {
		if (!id || id === currentId) {
			return;
		}

		vscodeApi.postMessage({ type: 'switchSession', id });
	};

	const onRename = () => {
		if (!currentId) {
			return;
		}

		const current = list.find((s) => s.id === currentId);
		const next = window.prompt(t('chat.session.renamePrompt'), current?.title ?? '');
		if (next === null) {
			return;
		}

		const title = next.trim();
		if (!title) {
			return;
		}

		vscodeApi.postMessage({ type: 'renameSession', id: currentId, title });
	};

	const onDelete = () => {
		if (!currentId) {
			return;
		}

		if (!window.confirm(t('chat.session.deleteConfirm'))) {
			return;
		}

		vscodeApi.postMessage({ type: 'deleteSession', id: currentId });
	};

	return (
		<header className="header">
			<div className="header__left">
				<span className="header__title">{t('chat.header.title')}</span>
				{list.length > 0 ? (
					<div className="session-bar" role="group" aria-label={t('chat.session.aria')}>
						<select
							className="session-bar__select"
							value={currentId}
							onChange={(e) => onSwitch(e.target.value)}
							title={t('chat.session.switch')}
						>
							{list.map((s) => (<option key={s.id} value={s.id}>{s.title}</option>))}
						</select>
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							title={t('chat.session.new')}
							onClick={() => vscodeApi.postMessage({ type: 'newSession' })}
						>
							+
						</button>
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							title={t('chat.session.rename')}
							onClick={onRename}
						>
							✎
						</button>
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							title={t('chat.session.delete')}
							onClick={onDelete}
						>
							*
						</button>
					</div>
				) : null}
			</div>
			<div className="header__actions">
				<TokenMeter usage={usage} maxContextTokens={maxContextTokens} compact />
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
