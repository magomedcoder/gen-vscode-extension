export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

function asCount(value: unknown): number {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function parseUsage(raw: unknown): TokenUsage | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}

	const row = raw as Record<string, unknown>;
	const promptTokens = asCount(row.prompt_tokens ?? row.promptTokens);
	const completionTokens = asCount(row.completion_tokens ?? row.completionTokens);
	const totalTokens = asCount(row.total_tokens ?? row.totalTokens) || promptTokens + completionTokens;
	if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) {
		return undefined;
	}

	return {
		promptTokens,
		completionTokens,
		totalTokens: totalTokens || promptTokens + completionTokens,
	};
}

export function addUsage(left?: TokenUsage, right?: TokenUsage): TokenUsage | undefined {
	if (!left) {
		return right;
	}

	if (!right) {
		return left;
	}

	return {
		promptTokens: left.promptTokens + right.promptTokens,
		completionTokens: left.completionTokens + right.completionTokens,
		totalTokens: left.totalTokens + right.totalTokens,
	};
}

export function sumUsage(items: Array<{ usage?: TokenUsage }>): TokenUsage | undefined {
	return items.reduce<TokenUsage | undefined>((acc, item) => addUsage(acc, item.usage), undefined);
}

export function formatTokenCount(n: number): string {
	if (n >= 10_000) {
		return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`;
	}

	return String(n);
}
