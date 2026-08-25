import type { ConfirmChoice, ConfirmVariant } from '../../chat/protocol';
import { t } from '../i18n';

export interface ConfirmPanelProps {
	title: string;
	detail?: string;
	hint?: string;
	variant?: ConfirmVariant;
	applyLabel?: string;
	skipLabel?: string;
	stopLabel?: string;
	rejectLabel?: string;
	badge?: string;
	className?: string;
	onChoose: (choice: ConfirmChoice) => void;
}

export function ConfirmPanel({
	title,
	detail,
	hint,
	variant = 'agent',
	applyLabel,
	skipLabel,
	stopLabel,
	rejectLabel,
	badge,
	className = 'confirm-card',
	onChoose,
}: ConfirmPanelProps) {
	const resolvedApply = applyLabel ?? t('agent.confirmApply');
	const resolvedSkip = skipLabel ?? t('agent.confirmSkip');
	const resolvedStop = stopLabel ?? t('agent.confirmStop');
	const resolvedReject = rejectLabel ?? t('comment.reject');
	const resolvedBadge = badge ?? t('confirm.badge');

	return (
		<section className={className} role="dialog" aria-labelledby="gen-confirm-title">
			<div className="confirm-card__header">
				<div className="confirm-card__heading">
					<span className="confirm-card__badge">{resolvedBadge}</span>
					<strong id="gen-confirm-title" className="confirm-card__title">{title}</strong>
				</div>
			</div>
			{hint ? <p className="confirm-card__hint">{hint}</p> : null}
			{detail ? <pre className="confirm-card__detail">{detail}</pre> : null}
			<div className="confirm-card__actions">
				<button className="btn" type="button" onClick={() => onChoose('apply')}>
					{resolvedApply}
				</button>
				{variant === 'agent' ? (
					<>
						<button className="btn btn--secondary" type="button" onClick={() => onChoose('skip')}>{resolvedSkip}</button>
						<button className="btn btn--secondary" type="button" onClick={() => onChoose('abort')}>{resolvedStop}</button>
					</>
				) : (
					<button className="btn btn--secondary" type="button" onClick={() => onChoose('abort')}>{resolvedReject}</button>
				)}
			</div>
		</section>
	);
}
