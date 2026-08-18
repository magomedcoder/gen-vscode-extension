import { extractPathFromPartialJson } from './types';

const CONTEXT = 2;
const MAX_LINES = 80;

export function formatMiniDiff(before: string, after: string): string {
	if (before === after) {
		return '';
	}

	const a = before.split('\n');
	const b = after.split('\n');
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		start += 1;
	}

	let aEnd = a.length - 1;
	let bEnd = b.length - 1;
	while (aEnd >= start && bEnd >= start && a[aEnd] === b[bEnd]) {
		aEnd -= 1;
		bEnd -= 1;
	}

	const ctxStart = Math.max(0, start - CONTEXT);
	const lines: string[] = [];
	for (let i = ctxStart; i < start; i += 1) {
		lines.push(` ${a[i]}`);
	}

	for (let i = start; i <= aEnd; i += 1) {
		lines.push(`-${a[i]}`);
	}

	for (let i = start; i <= bEnd; i += 1) {
		lines.push(`+${b[i]}`);
	}

	const ctxEndA = Math.min(a.length, aEnd + 1 + CONTEXT);
	for (let i = aEnd + 1; i < ctxEndA; i += 1) {
		lines.push(` ${a[i]}`);
	}

	if (lines.length > MAX_LINES) {
		return `${lines.slice(0, MAX_LINES).join('\n')}\n... [${lines.length - MAX_LINES} строк скрыто]`;
	}

	return lines.join('\n');
}

export function pathFromToolArguments(raw: string): string | undefined {
	try {
		const parsed = JSON.parse(raw.trim() || '{}') as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return extractPathFromPartialJson(raw);
		}

		const obj = parsed as Record<string, unknown>;
		if (typeof obj.path === 'string' && obj.path.trim()) {
			return obj.path.trim();
		}

		if (Array.isArray(obj.edits)) {
			const paths = obj.edits.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
				.map((item) => item.path)
				.filter((p): p is string => typeof p === 'string' && Boolean(p.trim()));

			if (paths.length === 0) {
				return undefined;
			}

			return [...new Set(paths)].join(', ');
		}

		if (Array.isArray(obj.steps)) {
			const paths = obj.steps.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
				.map((item) => item.path)
				.filter((p): p is string => typeof p === 'string' && Boolean(p.trim()));

			if (paths.length === 0) {
				return undefined;
			}

			return [...new Set(paths)].join(', ');
		}
	} catch {
		return extractPathFromPartialJson(raw);
	}

	return extractPathFromPartialJson(raw);
}
