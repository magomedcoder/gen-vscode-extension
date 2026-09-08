// Человекочитаемый preview аргументов tool для confirm-карточки и UI

export function formatToolArgsPreview(raw: string, maxChars = 1_200): string {
	const trimmed = raw.trim();
	if (!trimmed) {
		return '';
	}

	try {
		const parsed = JSON.parse(trimmed) as unknown;
		const pretty = JSON.stringify(parsed, null, 2);
		if (pretty.length <= maxChars) {
			return pretty;
		}
		return `${pretty.slice(0, maxChars)}\n...`;
	} catch {
		if (trimmed.length <= maxChars) {
			return trimmed;
		}
		return `${trimmed.slice(0, maxChars)}\n...`;
	}
}

// Краткий subject + args для detail карточки подтверждения
export function formatToolConfirmDetail(subject: string, rawArguments: string, toolName: string): string | undefined {
	const parts: string[] = [];
	const sub = subject.trim();
	if (sub && sub !== toolName) {
		parts.push(sub);
	}

	const args = formatToolArgsPreview(rawArguments);
	if (args) {
		parts.push(args);
	}
	
	return parts.length > 0 ? parts.join('\n\n') : undefined;
}
