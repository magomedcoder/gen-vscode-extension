export function isLocalhostHostname(hostname: string): boolean {
	const host = hostname.trim().toLowerCase();
	return host === 'localhost'
		|| host === '127.0.0.1'
		|| host === '::1'
		|| host === '[::1]'
		|| host === '0.0.0.0';
}

// true, если URL указывает на loopback (или пустой / невалидный - не считаем «облаком» для hints)
export function isLocalhostUrl(raw: string): boolean {
	const trimmed = raw.trim();
	if (!trimmed) {
		return true;
	}

	try {
		const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
			? trimmed
			: `http://${trimmed}`;
		const url = new URL(withScheme);
		return isLocalhostHostname(url.hostname);
	} catch {
		return false;
	}
}
