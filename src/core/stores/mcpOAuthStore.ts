import * as vscode from 'vscode';
import type { ExtensionContext, SecretStorage } from 'vscode';

// Токены OAuth для одного MCP-сервера (SecretStorage)
export interface McpOAuthTokens {
	accessToken: string;
	refreshToken?: string;
	// Epoch ms
	expiresAt?: number;
	meta?: Record<string, unknown>;
}

// Публичный debug-снимок без сырого токена
export interface McpOAuthDebugInfo {
	serverName: string;
	hasToken: boolean;
	// Маска вида ****abcd (последние 4 символа)
	maskedPreview?: string;
	expiresAt?: number;
	lastError?: string;
}

const SECRET_PREFIX = 'gen.mcpOAuth.';

let secrets: SecretStorage | undefined;
// Последняя ошибка OAuth по имени сервера (не в SecretStorage)
const lastErrors = new Map<string, string>();

function secretKey(serverName: string): string {
	// Имя сервера * безопасный суффикс ключа
	const safe = serverName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
	return `${SECRET_PREFIX}${safe || 'unnamed'}`;
}

// Маска токена для UI (без полного значения)
export function maskAccessToken(token: string): string {
	const t = token.trim();
	if (!t) {
		return '';
	}

	if (t.length <= 8) {
		return '****';
	}

	return `****${t.slice(-4)}`;
}

export function initMcpOAuthStore(context: ExtensionContext): void {
	secrets = context.secrets;
}

export function setMcpOAuthLastError(serverName: string, message: string | undefined): void {
	const name = serverName.trim();
	if (!name) {
		return;
	}

	if (!message?.trim()) {
		lastErrors.delete(name);
		return;
	}

	lastErrors.set(name, message.trim());
}

export function getMcpOAuthLastError(serverName: string): string | undefined {
	return lastErrors.get(serverName.trim());
}

export async function getMcpOAuthTokens(serverName: string): Promise<McpOAuthTokens | undefined> {
	if (!secrets) {
		return undefined;
	}

	const name = serverName.trim();
	if (!name) {
		return undefined;
	}

	try {
		const raw = await secrets.get(secretKey(name));
		if (!raw?.trim()) {
			return undefined;
		}

		const parsed = JSON.parse(raw) as Partial<McpOAuthTokens>;
		const accessToken = typeof parsed.accessToken === 'string' ? parsed.accessToken.trim() : '';
		if (!accessToken) {
			return undefined;
		}

		const out: McpOAuthTokens = { accessToken };
		if (typeof parsed.refreshToken === 'string' && parsed.refreshToken.trim()) {
			out.refreshToken = parsed.refreshToken.trim();
		}

		if (typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt)) {
			out.expiresAt = parsed.expiresAt;
		}

		if (parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta)) {
			out.meta = parsed.meta as Record<string, unknown>;
		}
		return out;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		setMcpOAuthLastError(name, message);
		return undefined;
	}
}

export async function setMcpOAuthTokens(serverName: string, tokens: McpOAuthTokens): Promise<void> {
	if (!secrets) {
		throw new Error(vscode.l10n.t('mcp.oauth.storeNotInit'));
	}

	const name = serverName.trim();
	if (!name) {
		throw new Error(vscode.l10n.t('mcp.oauth.invalidServer'));
	}

	const accessToken = tokens.accessToken.trim();
	if (!accessToken) {
		await clearMcpOAuthTokens(name);
		return;
	}

	const payload: McpOAuthTokens = { accessToken };
	if (tokens.refreshToken?.trim()) {
		payload.refreshToken = tokens.refreshToken.trim();
	}

	if (typeof tokens.expiresAt === 'number' && Number.isFinite(tokens.expiresAt)) {
		payload.expiresAt = tokens.expiresAt;
	}

	if (tokens.meta && typeof tokens.meta === 'object') {
		payload.meta = tokens.meta;
	}

	await secrets.store(secretKey(name), JSON.stringify(payload));
	lastErrors.delete(name);
}

export async function clearMcpOAuthTokens(serverName: string): Promise<void> {
	if (!secrets) {
		return;
	}

	const name = serverName.trim();
	if (!name) {
		return;
	}

	await secrets.delete(secretKey(name));
	lastErrors.delete(name);
}

// Debug без сырого токена
export async function getMcpOAuthDebugInfo(serverName: string): Promise<McpOAuthDebugInfo> {
	const name = serverName.trim();
	const tokens = name ? await getMcpOAuthTokens(name) : undefined;
	const hasToken = Boolean(tokens?.accessToken);

	return {
		serverName: name,
		hasToken,
		...(hasToken && tokens ? { 
			maskedPreview: maskAccessToken(tokens.accessToken) 
		} : {}),
		...(typeof tokens?.expiresAt === 'number' ? { 
			expiresAt: tokens.expiresAt 
		} : {}),
		...(getMcpOAuthLastError(name) ? { 
			lastError: getMcpOAuthLastError(name) 
		} : {}),
	};
}
