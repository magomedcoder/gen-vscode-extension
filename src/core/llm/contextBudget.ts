import type { GenSettings } from '../config/types';

// Запас поверх completion + compactReserved
export const CONTEXT_SAFETY_MARGIN = 256;

// Порог «почти полный» контекст - mid-loop prune
export const CONTEXT_NEAR_BUDGET_RATIO = 0.85;

const nCtxCache = new Map<string, number>();

function cacheKey(baseUrl: string, model: string): string {
	return `${baseUrl.trim()}|${model.trim()}`;
}

export function getCachedNCtx(baseUrl: string, model: string): number | undefined {
	const key = cacheKey(baseUrl, model);
	if (!key || key === '|') {
		return undefined;
	}

	return nCtxCache.get(key);
}

export function setCachedNCtx(baseUrl: string, model: string, nCtx: number): void {
	const key = cacheKey(baseUrl, model);
	if (!key || key === '|' || !Number.isFinite(nCtx) || nCtx < 512) {
		return;
	}

	nCtxCache.set(key, Math.floor(nCtx));
}

export function clearCachedNCtx(baseUrl?: string, model?: string): void {
	if (baseUrl === undefined && model === undefined) {
		nCtxCache.clear();
		return;
	}

	nCtxCache.delete(cacheKey(baseUrl ?? '', model ?? ''));
}

// Effective prompt budget: min(maxContextTokens, n_ctx?) − maxTokens(completion) − compactReserved − safety
export function getEffectiveContextBudget(settings: GenSettings, nCtx?: number): number {
	const windowSize = Math.min(
		settings.maxContextTokens,
		nCtx ?? settings.maxContextTokens,
	);
	const completionReserve = Math.min(
		Math.max(64, settings.maxTokens),
		Math.floor(windowSize / 2),
	);
	const reserved = completionReserve + Math.max(0, settings.compactReservedTokens) + CONTEXT_SAFETY_MARGIN;
	
	return Math.max(1024, windowSize - reserved);
}

export function isNearContextBudget(estimatedTokens: number, budget: number): boolean {
	return estimatedTokens >= budget * CONTEXT_NEAR_BUDGET_RATIO;
}

export function isOverContextBudget(estimatedTokens: number, budget: number): boolean {
	return estimatedTokens > budget;
}
