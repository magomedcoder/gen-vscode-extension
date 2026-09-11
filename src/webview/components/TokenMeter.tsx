import type { TokenUsage } from '../../core/llm/usage';
import { formatTokenCount } from '../../core/llm/usage';
import { t } from '../i18n';

interface TokenMeterProps {
	usage?: TokenUsage;
	maxContextTokens?: number;
	compact?: boolean;
	estimatedPromptTokens?: number;
	contextBudget?: number;
	cachedNCtx?: number;
	lastContextPrune?: { 
		chars: number; 
		messages: number 
	};
	nearBudget?: boolean;
	nCtxWarn?: boolean;
	contextBreakdown?: {
		history: number;
		mentions: number;
		system: number;
		user: number;
	};
	mentionsTruncated?: boolean;
}

export function TokenMeter({
	usage,
	maxContextTokens,
	compact,
	estimatedPromptTokens,
	contextBudget,
	cachedNCtx,
	lastContextPrune,
	nearBudget,
	nCtxWarn,
	contextBreakdown,
	mentionsTruncated,
}: TokenMeterProps) {
	const hasUsage = Boolean(usage && usage.totalTokens > 0);
	const hasBudgetHint = typeof estimatedPromptTokens === 'number'
		|| typeof contextBudget === 'number'
		|| typeof cachedNCtx === 'number';

	if (!hasUsage && !hasBudgetHint) {
		return null;
	}

	const limit = (typeof contextBudget === 'number' && contextBudget > 0)
		? contextBudget
		: (maxContextTokens && maxContextTokens > 0 ? maxContextTokens : undefined);
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

	if (contextBreakdown) {
		budgetBits.push(
			`h${formatTokenCount(contextBreakdown.history)}/m${formatTokenCount(contextBreakdown.mentions)}/u${formatTokenCount(contextBreakdown.user)}`,
		);
	}

	const budgetText = budgetBits.length > 0 ? budgetBits.toString() : undefined;
	const titleParts = [
		budgetText,
		nCtxWarn ? t('chat.tokens.nCtxWarn') : '',
		mentionsTruncated ? t('chat.tokens.mentionsTruncated') : '',
		nearBudget ? t('chat.tokens.nearBudget') : '',
	].filter(Boolean);

	if (compact) {
		return (
			<span className={`token-meter-wrap${nearBudget ? ' token-meter-wrap--near' : ''}${nCtxWarn ? ' token-meter-wrap--warn' : ''}`}>
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
						title={titleParts.join('\n') || t('chat.tokens.budgetTitle', budgetText)}
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
