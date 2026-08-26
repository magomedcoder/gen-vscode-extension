import { useEffect, useState } from 'react';
import type { StickyPlanUi } from '../../chat/protocol';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

interface PlanCardProps {
	plan: StickyPlanUi;
}

const COLLAPSE_KEY = 'gen.planCard.collapsed';

function readCollapsed(): boolean {
	try {
		return sessionStorage.getItem(COLLAPSE_KEY) === '1';
	} catch {
		return false;
	}
}

export function PlanCard({ plan }: PlanCardProps) {
	const [collapsed, setCollapsed] = useState(readCollapsed);
	const done = plan.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;

	useEffect(() => {
		try {
			sessionStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
		} catch {}
	}, [collapsed]);

	const toggle = () => setCollapsed((v) => !v);

	return (
		<section
			className={`plan-card${collapsed ? ' plan-card--collapsed' : ''}`}
			aria-label={t('chat.plan.aria')}
		>
			<div className="plan-card__header">
				<button
					type="button"
					className="plan-card__toggle"
					aria-expanded={!collapsed}
					aria-label={collapsed ? t('chat.plan.expand') : t('chat.plan.collapse')}
					onClick={toggle}
				>
					<span className="plan-card__chevron" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
					<span className="plan-card__heading">
						<span className="plan-card__label">{t('chat.plan.aria')}</span>
						<span className="plan-card__title">{plan.title}</span>
						<span className="plan-card__badge">{done}/{plan.steps.length}</span>
					</span>
				</button>
				{collapsed ? null : (
					<button
						type="button"
						className="btn btn--secondary plan-card__open"
						onClick={() => vscodeApi.postMessage({ type: 'openPlan' })}
					>
						{t('chat.plan.open')}
					</button>
				)}
			</div>

			{collapsed ? null : (
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
			)}
		</section>
	);
}
