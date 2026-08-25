import type { TokenUsage } from '../../llm/usage';
import { formatTokenCount } from '../../llm/usage';
import { t } from '../i18n';

interface TokenMeterProps {
	usage?: TokenUsage;
	compact?: boolean;
}

export function TokenMeter({ usage, compact }: TokenMeterProps) {
	if (!usage || usage.totalTokens <= 0) {
		return null;
	}

	if (compact) {
		return (<span className="token-meter">{t('chat.tokens.compact', formatTokenCount(usage.totalTokens))}</span>);
	}

	return (
		<div className="token-meter token-meter--msg">
			{t('chat.tokens.detail', formatTokenCount(usage.promptTokens), formatTokenCount(usage.completionTokens))}
		</div>
	);
}
