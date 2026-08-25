import type { StickyPlanUi } from '../../chat/protocol';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

interface PlanCardProps {
	plan: StickyPlanUi;
}

export function PlanCard({ plan }: PlanCardProps) {
	const done = plan.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;

	return (
		<section className="plan-card" aria-label={t('chat.plan.aria')}>
			<div className="plan-card__header">
				<div className="plan-card__heading">
					<span className="plan-card__title">{plan.title}</span>
					<span className="plan-card__badge">{done}/{plan.steps.length}</span>
				</div>
				<button
					type="button"
					className="btn btn--secondary plan-card__cancel"
					onClick={() => vscodeApi.postMessage({ type: 'openPlan' })}
				>
					{t('chat.plan.open')}
				</button>
			</div>
			<ol className="plan-card__steps">
				{plan.steps.map((step, i) => (
					<li
						key={`${i}-${step.title}`}
						className={`plan-card__step plan-card__step--${step.status}`}
					>
						<span className="plan-card__step-status">{t(`chat.plan.status.${step.status}`)}</span>
						<span className="plan-card__step-body">
							<span className="plan-card__step-title">{i + 1}. {step.title}</span>
							{step.path ? <span className="plan-card__step-path">{step.path}</span> : null}
						</span>
					</li>
				))}
			</ol>
		</section>
	);
}
