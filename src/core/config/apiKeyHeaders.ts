// Auth headers для LLM / embeddings (без зависимости от SecretStorage)
export function buildAuthHeaders(apiKey: string, headerName: string, scheme: string): Record<string, string> {
	const key = apiKey.trim();
	if (!key) {
		return {};
	}

	const name = headerName.trim() || 'Authorization';
	const prefix = scheme.trim();
	return {
		[name]: prefix ? `${prefix} ${key}` : key,
	};
}
