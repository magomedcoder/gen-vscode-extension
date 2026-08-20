import type { ConfirmChoice, ConfirmVariant } from '../../chat/protocol';

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
	applyLabel = 'Применить',
	skipLabel = 'Пропустить',
	stopLabel = 'Стоп',
	rejectLabel = 'Отклонить',
	badge = 'Подтверждение',
	className = 'confirm-card',
	onChoose,
}: ConfirmPanelProps) {
	return (
		<section className={className} role="dialog" aria-labelledby="gen-confirm-title">
			<div className="confirm-card__header">
				<div className="confirm-card__heading">
					<span className="confirm-card__badge">{badge}</span>
					<strong id="gen-confirm-title" className="confirm-card__title">{title}</strong>
				</div>
			</div>
			{hint ? <p className="confirm-card__hint">{hint}</p> : null}
			{detail ? <pre className="confirm-card__detail">{detail}</pre> : null}
			<div className="confirm-card__actions">
				<button className="btn" type="button" onClick={() => onChoose('apply')}>
					{applyLabel}
				</button>
				{variant === 'agent' ? (
					<>
						<button className="btn btn--secondary" type="button" onClick={() => onChoose('skip')}>{skipLabel}</button>
						<button className="btn btn--secondary" type="button" onClick={() => onChoose('abort')}>{stopLabel}</button>
					</>
				) : (
					<button className="btn btn--secondary" type="button" onClick={() => onChoose('abort')}>{rejectLabel}</button>
				)}
			</div>
		</section>
	);
}
