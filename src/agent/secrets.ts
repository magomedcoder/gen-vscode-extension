const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
	{ name: 'pem', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
	{ name: 'aws', re: /\bAKIA[0-9A-Z]{16}\b/g },
	{ name: 'github', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
	{ name: 'github_pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
	{ name: 'slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
	{ name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
	{ name: 'bearer', re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
	{ name: 'generic_key', re: /\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi },
];

export function redactSecrets(text: string): { text: string; count: number } {
	let next = text;
	let count = 0;
	for (const { re } of SECRET_PATTERNS) {
		next = next.replace(re, () => {
			count += 1;
			return '[REDACTED]';
		});
		re.lastIndex = 0;
	}

	return { 
		text: next, 
		count 
	};
}
