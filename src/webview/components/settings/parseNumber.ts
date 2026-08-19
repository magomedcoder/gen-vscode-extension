export function parseNumberInput(raw: string, fallback: number): number {
	if (!raw.trim()) {
		return fallback;
	}

	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}
