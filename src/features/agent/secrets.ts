import { getSettings } from '../../core/config/settings';

function compilePatterns(patterns: readonly string[]): RegExp[] {
	const compiled: RegExp[] = [];
	for (const item of patterns) {
		const line = item.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}

		try {
			compiled.push(new RegExp(line, 'gi'));
		} catch {
			continue;
		}
	}

	return compiled;
}

export function redactSecrets(text: string, patterns?: readonly string[]): { text: string; count: number } {
	const source = patterns ?? getSettings().secretPatterns;
	let next = text;
	let count = 0;
	for (const re of compilePatterns(source)) {
		next = next.replace(re, () => {
			count += 1;
			return '[REDACTED]';
		});
	}

	return {
		text: next,
		count,
	};
}
