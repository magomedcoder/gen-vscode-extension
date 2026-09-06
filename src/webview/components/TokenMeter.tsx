import type { TokenUsage } from '../../core/llm/usage';
import { formatTokenCount } from '../../core/llm/usage';
import { t } from '../i18n';

interface TokenMeterProps {
	usage?: TokenUsage;
	maxContextTokens?: number;
	compact?: boolean;
}

export function TokenMeter({ usage, maxContextTokens, compact }: TokenMeterProps) {
	if (!usage || usage.totalTokens <= 0) {
		return null;
	}

	const limit = maxContextTokens && maxContextTokens > 0 ? maxContextTokens : undefined;
	const pct = limit ? Math.min(100, Math.round((usage.totalTokens / limit) * 100)) : undefined;

	if (compact) {
		if (limit) {
			return (
				<span
					className="token-meter token-meter--ring"
					title={t('chat.tokens.contextTitle', formatTokenCount(usage.totalTokens), formatTokenCount(limit))}
				>
					{t('chat.tokens.context', formatTokenCount(usage.totalTokens), formatTokenCount(limit), pct ?? 0)}
				</span>
			);
		}

		return (<span className="token-meter">{t('chat.tokens.compact', formatTokenCount(usage.totalTokens))}</span>);
	}

	return (
		<div className="token-meter token-meter--msg">
			{t('chat.tokens.detail', formatTokenCount(usage.promptTokens), formatTokenCount(usage.completionTokens))}
		</div>
	);
}
