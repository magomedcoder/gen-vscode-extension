const DEFAULT_TIMEOUT_MS = 15_000;

// Скачать текст по HTTPS (только https). Обрезка по maxChars
export async function fetchHttpsText(
	urlRaw: string,
	maxChars: number,
	opts?: { 
		signal?: AbortSignal; 
		timeoutMs?: number
	},
): Promise<{
	ok: true;
	text: string;
	url: string
} | {
	ok: false;
	reason: string
}> {
	const trimmed = urlRaw.trim();
	if (!trimmed || trimmed.startsWith('#')) {
		return {
			ok: false,
			reason: 'пустой URL'
		};
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return {
			ok: false,
			reason: 'невалидный URL'
		};
	}

	if (url.protocol !== 'https:') {
		return {
			ok: false,
			reason: 'разрешён только HTTPS'
		};
	}

	const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	opts?.signal?.addEventListener('abort', onAbort, { once: true });
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetch(url.toString(), {
			method: 'GET',
			signal: controller.signal,
			headers: {
				Accept: 'text/plain, text/markdown, text/*, */*',
			},
		});
		if (!res.ok) {
			return {
				ok: false,
				reason: `HTTP ${res.status}`
			};
		}

		const text = await res.text();
		const capped = text.length > maxChars
			? `${text.slice(0, maxChars)}\n\n[truncated]`
			: text;
		return {
			ok: true,
			text: capped,
			url: url.toString()
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			reason: msg
		};
	} finally {
		clearTimeout(timer);
		opts?.signal?.removeEventListener('abort', onAbort);
	}
}
