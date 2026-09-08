import * as vscode from 'vscode';
import type { ExtensionContext, SecretStorage } from 'vscode';

// Токены OAuth для одного MCP-сервера (SecretStorage)
export interface McpOAuthTokens {
	accessToken: string;
	refreshToken?: string;
	// Epoch мс
	expiresAt?: number;
	meta?: Record<string, unknown>;
}

// Публичный debug-снимок без сырого токена
export interface McpOAuthDebugInfo {
	serverName: string;
	hasToken: boolean;
	hasRefreshToken?: boolean;
	// Маска вида ****abcd (последние 4 символа)
	maskedPreview?: string;
	expiresAt?: number;
	lastError?: string;
}

// Запас до expiresAt, после которого считаем access истёкшим (мс)
const REFRESH_SKEW_MS = 60_000;

const SECRET_PREFIX = 'gen.mcpOAuth.';
const PKCE_SECRET_PREFIX = 'gen.mcpOAuth.pkce.';
const PKCE_STATE_PREFIX = 'gen.mcpOAuth.pkceState.';

let secrets: SecretStorage | undefined;
// Последняя ошибка OAuth по имени сервера (не в SecretStorage)
const lastErrors = new Map<string, string>();

function safeServerKey(serverName: string): string {
	return serverName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'unnamed';
}

function secretKey(serverName: string): string {
	// Имя сервера * безопасный суффикс ключа
	return `${SECRET_PREFIX}${safeServerKey(serverName)}`;
}

function pkceSecretKey(serverName: string): string {
	return `${PKCE_SECRET_PREFIX}${safeServerKey(serverName)}`;
}

function pkceStateKey(state: string): string {
	const safe = state.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160);
	return `${PKCE_STATE_PREFIX}${safe || 'empty'}`;
}

// PKCE-сессия для текущего authorization_code flow
export interface McpOAuthPkceSession {
	serverName: string;
	codeVerifier: string;
	state: string;
	tokenUrl: string;
	redirectUri: string;
	clientId: string;
	createdAt: number;
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
	await clearMcpOAuthPkceSession(name);
	lastErrors.delete(name);
}

// Access истёк (или истечёт в пределах skew)
export function isMcpOAuthAccessExpired(tokens: McpOAuthTokens, nowMs: number = Date.now()): boolean {
	if (typeof tokens.expiresAt !== 'number' || !Number.isFinite(tokens.expiresAt)) {
		return false;
	}

	return tokens.expiresAt <= nowMs + REFRESH_SKEW_MS;
}

export async function setMcpOAuthPkceSession(session: McpOAuthPkceSession): Promise<void> {
	if (!secrets) {
		throw new Error(vscode.l10n.t('mcp.oauth.storeNotInit'));
	}

	const name = session.serverName.trim();
	if (!name || !session.codeVerifier.trim() || !session.state.trim()) {
		throw new Error(vscode.l10n.t('mcp.oauth.invalidServer'));
	}

	const payload: McpOAuthPkceSession = {
		serverName: name,
		codeVerifier: session.codeVerifier.trim(),
		state: session.state.trim(),
		tokenUrl: session.tokenUrl.trim(),
		redirectUri: session.redirectUri.trim(),
		clientId: session.clientId.trim(),
		createdAt: session.createdAt || Date.now(),
	};
	await secrets.store(pkceSecretKey(name), JSON.stringify(payload));
	await secrets.store(pkceStateKey(payload.state), name);
}

export async function getMcpOAuthPkceSession(serverName: string): Promise<McpOAuthPkceSession | undefined> {
	if (!secrets) {
		return undefined;
	}

	const name = serverName.trim();
	if (!name) {
		return undefined;
	}

	try {
		const raw = await secrets.get(pkceSecretKey(name));
		if (!raw?.trim()) {
			return undefined;
		}

		const parsed = JSON.parse(raw) as Partial<McpOAuthPkceSession>;
		if (
			typeof parsed.codeVerifier !== 'string'
			|| typeof parsed.state !== 'string'
			|| typeof parsed.tokenUrl !== 'string'
			|| typeof parsed.redirectUri !== 'string'
			|| typeof parsed.clientId !== 'string'
		) {
			return undefined;
		}

		return {
			serverName: name,
			codeVerifier: parsed.codeVerifier,
			state: parsed.state,
			tokenUrl: parsed.tokenUrl,
			redirectUri: parsed.redirectUri,
			clientId: parsed.clientId,
			createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
		};
	} catch {
		return undefined;
	}
}

export async function getMcpOAuthPkceSessionByState(state: string): Promise<McpOAuthPkceSession | undefined> {
	if (!secrets || !state.trim()) {
		return undefined;
	}

	try {
		const serverName = await secrets.get(pkceStateKey(state.trim()));
		if (!serverName?.trim()) {
			return undefined;
		}

		return getMcpOAuthPkceSession(serverName);
	} catch {
		return undefined;
	}
}

export async function clearMcpOAuthPkceSession(serverName: string): Promise<void> {
	if (!secrets) {
		return;
	}

	const name = serverName.trim();
	if (!name) {
		return;
	}

	const existing = await getMcpOAuthPkceSession(name);
	await secrets.delete(pkceSecretKey(name));
	if (existing?.state) {
		await secrets.delete(pkceStateKey(existing.state));
	}
}

/**
 * Обновление: POST token URL (x-www-form-urlencoded, grant_type=refresh_token).
 * PKCE / discovery: см. mcpOAuthPkce.ts + SettingsPanel Auth.
 */
export async function refreshMcpOAuthTokens(
	serverName: string,
	tokenUrl: string,
	opts?: { fetchFn?: typeof fetch },
): Promise<McpOAuthTokens | undefined> {
	const name = serverName.trim();
	const url = tokenUrl.trim();
	if (!name || !url) {
		return undefined;
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		setMcpOAuthLastError(name, vscode.l10n.t('mcp.oauth.invalidTokenUrl'));
		return undefined;
	}

	if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
		setMcpOAuthLastError(name, vscode.l10n.t('mcp.oauth.invalidTokenUrl'));
		return undefined;
	}

	const current = await getMcpOAuthTokens(name);
	const refreshToken = current?.refreshToken?.trim();
	if (!refreshToken) {
		return current;
	}

	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
	});
	const clientId = typeof current?.meta?.client_id === 'string' ? current.meta.client_id.trim() : '';
	if (clientId) {
		body.set('client_id', clientId);
	}

	const fetchFn = opts?.fetchFn ?? fetch.bind(globalThis);
	try {
		const res = await fetchFn(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: body.toString(),
		});
		const text = await res.text();
		if (!res.ok) {
			const message = `HTTP ${res.status}: ${text.slice(0, 240)}`;
			setMcpOAuthLastError(name, message);
			return undefined;
		}

		let json: Record<string, unknown>;
		try {
			json = JSON.parse(text) as Record<string, unknown>;
		} catch {
			setMcpOAuthLastError(name, vscode.l10n.t('mcp.oauth.refreshBadJson'));
			return undefined;
		}

		const accessToken = typeof json.access_token === 'string' ? json.access_token.trim() : '';
		if (!accessToken) {
			setMcpOAuthLastError(name, vscode.l10n.t('mcp.oauth.refreshNoAccess'));
			return undefined;
		}

		const nextRefresh = typeof json.refresh_token === 'string' && json.refresh_token.trim()
			? json.refresh_token.trim()
			: refreshToken;
		const expiresIn = typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)
			? Math.max(0, Math.floor(json.expires_in))
			: undefined;
		const next: McpOAuthTokens = {
			accessToken,
			refreshToken: nextRefresh,
			...(expiresIn !== undefined ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
			...(current?.meta ? { meta: current.meta } : {}),
		};
		await setMcpOAuthTokens(name, next);
		setMcpOAuthLastError(name, undefined);
		return next;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		setMcpOAuthLastError(name, message);
		return undefined;
	}
}

// Если access истёк и есть refresh_token + tokenUrl - обновить; иначе вернуть текущие
export async function ensureFreshMcpOAuthTokens(
	serverName: string,
	tokenUrl?: string,
	opts?: { fetchFn?: typeof fetch },
): Promise<McpOAuthTokens | undefined> {
	const name = serverName.trim();
	if (!name) {
		return undefined;
	}

	const current = await getMcpOAuthTokens(name);
	if (!current?.accessToken) {
		return undefined;
	}

	if (!isMcpOAuthAccessExpired(current)) {
		return current;
	}

	const url = (tokenUrl ?? '').trim();
	if (!url || !current.refreshToken?.trim()) {
		return current;
	}

	const refreshed = await refreshMcpOAuthTokens(name, url, opts);
	return refreshed ?? current;
}

// Разбор paste: plain access token или JSON { access_token, refresh_token?, expires_in? }
export function parseMcpOAuthPastePayload(raw: string): McpOAuthTokens | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}

	if (trimmed.startsWith('{')) {
		try {
			const json = JSON.parse(trimmed) as Record<string, unknown>;
			const accessToken = typeof json.access_token === 'string'
				? json.access_token.trim()
				: typeof json.accessToken === 'string'
					? json.accessToken.trim()
					: '';
			if (!accessToken) {
				return undefined;
			}

			const refreshToken = typeof json.refresh_token === 'string'
				? json.refresh_token.trim()
				: typeof json.refreshToken === 'string'
					? json.refreshToken.trim()
					: undefined;
			const expiresIn = typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)
				? Math.max(0, Math.floor(json.expires_in))
				: typeof json.expiresIn === 'number' && Number.isFinite(json.expiresIn)
					? Math.max(0, Math.floor(json.expiresIn))
					: undefined;
			return {
				accessToken,
				...(refreshToken ? { refreshToken } : {}),
				...(expiresIn !== undefined ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
			};
		} catch {
			return undefined;
		}
	}

	return { accessToken: trimmed };
}

// Debug без сырого токена
export async function getMcpOAuthDebugInfo(serverName: string): Promise<McpOAuthDebugInfo> {
	const name = serverName.trim();
	const tokens = name ? await getMcpOAuthTokens(name) : undefined;
	const hasToken = Boolean(tokens?.accessToken);

	return {
		serverName: name,
		hasToken,
		hasRefreshToken: Boolean(tokens?.refreshToken?.trim()),
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
