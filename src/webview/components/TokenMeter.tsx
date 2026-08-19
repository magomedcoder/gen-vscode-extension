import type { TokenUsage } from '../../llm/usage';
import { formatTokenCount } from '../../llm/usage';

interface TokenMeterProps {
	usage?: TokenUsage;
	compact?: boolean;
}

export function TokenMeter({ usage, compact }: TokenMeterProps) {
	if (!usage || usage.totalTokens <= 0) {
		return null;
	}

	if (compact) {
		return (<span className="token-meter">{formatTokenCount(usage.totalTokens)} токенов</span>);
	}

	return (
		<div className="token-meter token-meter--msg">
			вход {formatTokenCount(usage.promptTokens)} токенов | выход {formatTokenCount(usage.completionTokens)} токенов
		</div>
	);
}
