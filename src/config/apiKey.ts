import type { ExtensionContext, SecretStorage } from 'vscode';

const API_KEY_SECRET = 'gen.apiKey';

let secrets: SecretStorage | undefined;

export function initApiKeyStore(context: ExtensionContext): void {
	secrets = context.secrets;
}

export async function getApiKey(): Promise<string> {
	return (await secrets?.get(API_KEY_SECRET))?.trim() ?? '';
}

export async function hasApiKey(): Promise<boolean> {
	return Boolean(await getApiKey());
}

export async function setApiKey(value: string): Promise<void> {
	if (!secrets) {
		throw new Error('Хранилище ключа не инициализировано');
	}

	const trimmed = value.trim();
	if (!trimmed) {
		await secrets.delete(API_KEY_SECRET);
		return;
	}

	await secrets.store(API_KEY_SECRET, trimmed);
}

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
