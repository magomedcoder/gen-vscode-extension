import type { TokenUsage } from '../../core/llm/usage';
import { formatTokenCount } from '../../core/llm/usage';
import { t } from '../i18n';

interface TokenMeterProps {
	usage?: TokenUsage;
	maxContextTokens?: number;
	compact?: boolean;
	// Оценка prompt (fitContext)
	estimatedPromptTokens?: number;
	// Эффективный budget
	contextBudget?: number;
	// Кэш серверного n_ctx
	cachedNCtx?: number;
	// Последние счётчики prune (debug)
	lastContextPrune?: { 
		chars: number; 
		messages: number 
	};
}

export function TokenMeter({
	usage,
	maxContextTokens,
	compact,
	estimatedPromptTokens,
	contextBudget,
	cachedNCtx,
	lastContextPrune,
}: TokenMeterProps) {
	const hasUsage = Boolean(usage && usage.totalTokens > 0);
	const hasBudgetHint = typeof estimatedPromptTokens === 'number'
		|| typeof contextBudget === 'number'
		|| typeof cachedNCtx === 'number';

	if (!hasUsage && !hasBudgetHint) {
		return null;
	}

	const limit = maxContextTokens && maxContextTokens > 0 ? maxContextTokens : undefined;
	const used = usage?.totalTokens ?? estimatedPromptTokens ?? 0;
	const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : undefined;

	const budgetBits: string[] = [];
	if (typeof estimatedPromptTokens === 'number' && estimatedPromptTokens > 0) {
		budgetBits.push(`prompt ${formatTokenCount(estimatedPromptTokens)}`);
	}

	if (typeof contextBudget === 'number' && contextBudget > 0) {
		budgetBits.push(`bud ${formatTokenCount(contextBudget)}`);
	}

	if (typeof cachedNCtx === 'number' && cachedNCtx > 0) {
		budgetBits.push(`n_ctx ${formatTokenCount(cachedNCtx)}`);
	}

	if (lastContextPrune && (lastContextPrune.chars > 0 || lastContextPrune.messages > 0)) {
		budgetBits.push(`−${lastContextPrune.messages}msg`);
	}

	const budgetText = budgetBits.length > 0 ? budgetBits.toString() : undefined;

	if (compact) {
		return (
			<span className="token-meter-wrap">
				{hasUsage && limit ? (
					<span
						className="token-meter token-meter--ring"
						title={t('chat.tokens.contextTitle', formatTokenCount(used), formatTokenCount(limit))}
					>
						{t('chat.tokens.context', formatTokenCount(used), formatTokenCount(limit), pct ?? 0)}
					</span>
				) : hasUsage ? (
					<span className="token-meter">{t('chat.tokens.compact', formatTokenCount(usage!.totalTokens))}</span>
				) : null}
				{budgetText ? (
					<span
						className="token-meter token-meter--budget"
						title={t('chat.tokens.budgetTitle', budgetText)}
					>
						{budgetText}
					</span>
				) : null}
			</span>
		);
	}

	if (!hasUsage) {
		return null;
	}

	return (
		<div className="token-meter token-meter--msg">
			{t('chat.tokens.detail', formatTokenCount(usage!.promptTokens), formatTokenCount(usage!.completionTokens))}
		</div>
	);
}
