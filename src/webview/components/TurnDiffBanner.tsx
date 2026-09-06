import type { SessionDiffEvent } from '../../chat/protocol';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

const PATH_PREVIEW_LIMIT = 6;

interface TurnDiffBannerProps {
	diff: SessionDiffEvent;
}

function openPath(path: string): void {
	vscodeApi.postMessage({ type: 'openPath', path });
}

// Баннер: файлы, изменённые за последний agent-ход
export function TurnDiffBanner({ diff }: TurnDiffBannerProps) {
	const paths = diff.paths;
	if (paths.length === 0) {
		return null;
	}

	const preview = paths.slice(0, PATH_PREVIEW_LIMIT);
	const extra = paths.length - preview.length;

	return (
		<div className="turn-diff" role="status">
			<div className="turn-diff__main">
				<span className="turn-diff__label">{t('chat.turnDiff.changed')}</span>
				<span className="turn-diff__paths" title={paths.join(', ')}>
					{preview.map((path, index) => (
						<span key={path}>
							{index > 0 ? ', ' : null}
							<button
								type="button"
								className="turn-diff__path"
								onClick={() => openPath(path)}
							>
								{path}
							</button>
						</span>
					))}
					{extra > 0 ? <span className="turn-diff__more">, +{extra}</span> : null}
				</span>
			</div>
			<button
				type="button"
				className="btn btn--secondary turn-diff__dismiss"
				onClick={() => vscodeApi.postMessage({ type: 'dismissTurnDiff' })}
			>
				{t('chat.turnDiff.dismiss')}
			</button>
		</div>
	);
}
