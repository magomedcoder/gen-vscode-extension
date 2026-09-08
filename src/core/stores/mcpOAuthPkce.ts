import { createHash, randomBytes } from 'node:crypto';

// Хелперы PKCE + OIDC discovery (чистые; без VS Code)

export interface OAuthDiscoveredEndpoints {
	authorizationEndpoint?: string;
	tokenEndpoint?: string;
	issuer?: string;
}

export interface PkcePair {
	verifier: string;
	challenge: string;
	challengeMethod: 'S256';
}

export interface AuthorizationCallbackParse {
	// authorization code (для обмена на токены)
	code?: string;
	// обычный access token / JSON paste - предпочтительнее, если нет code
	pasteTokens?: boolean;
	raw: string;
}

function base64Url(buf: Buffer): string {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// Пара PKCE RFC 7636 S256
export function generatePkcePair(): PkcePair {
	const verifier = base64Url(randomBytes(32));
	const challenge = base64Url(createHash('sha256').update(verifier).digest());
	return {
		verifier,
		challenge,
		challengeMethod: 'S256',
	};
}

export function generateOAuthState(): string {
	return base64Url(randomBytes(16));
}

function isHttpUrl(value: string): boolean {
	try {
		const u = new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

function stripTrailingSlash(url: string): string {
	return url.replace(/\/+$/, '');
}

// GET `{issuer}/.well-known/openid-configuration`, затем `{issuer}/.well-known/oauth-authorization-server`.
export async function discoverOAuthEndpoints(
	issuer: string,
	opts?: { fetchFn?: typeof fetch },
): Promise<OAuthDiscoveredEndpoints> {
	const base = stripTrailingSlash(issuer.trim());
	if (!base || !isHttpUrl(base)) {
		return {};
	}

	const fetchFn = opts?.fetchFn ?? fetch.bind(globalThis);
	const paths = [
		'/.well-known/openid-configuration',
		'/.well-known/oauth-authorization-server',
	];

	for (const suffix of paths) {
		try {
			const res = await fetchFn(`${base}${suffix}`, {
				method: 'GET',
				headers: { Accept: 'application/json' },
			});
			if (!res.ok) {
				continue;
			}

			const json = await res.json() as Record<string, unknown>;
			const authorizationEndpoint = typeof json.authorization_endpoint === 'string'
				? json.authorization_endpoint.trim()
				: undefined;
			const tokenEndpoint = typeof json.token_endpoint === 'string'
				? json.token_endpoint.trim()
				: undefined;
			const discoveredIssuer = typeof json.issuer === 'string' ? json.issuer.trim() : base;
			if (authorizationEndpoint || tokenEndpoint) {
				return {
					authorizationEndpoint: authorizationEndpoint && isHttpUrl(authorizationEndpoint)
						? authorizationEndpoint
						: undefined,
					tokenEndpoint: tokenEndpoint && isHttpUrl(tokenEndpoint)
						? tokenEndpoint
						: undefined,
					issuer: discoveredIssuer,
				};
			}
		} catch {}
	}

	return {};
}

export function buildAuthorizeUrl(params: {
	authorizeUrl: string;
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	state: string;
	scope?: string;
}): string {
	const url = new URL(params.authorizeUrl);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', params.clientId);
	url.searchParams.set('redirect_uri', params.redirectUri);
	url.searchParams.set('code_challenge', params.codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('state', params.state);
	if (params.scope?.trim()) {
		url.searchParams.set('scope', params.scope.trim());
	}
	return url.toString();
}

/**
 * Вставка authorization `code`, redirect URL с `code=`, или (fallback) access token / JSON.
 * Возвращает code, если есть; иначе pasteTokens=true для существующего paste-token пути.
 */
export function parseAuthorizationCallbackInput(raw: string): AuthorizationCallbackParse {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { raw: trimmed };
	}

	// Redirect URL или query string с code=
	const codeFromUrl = extractCodeFromRedirectLike(trimmed);
	if (codeFromUrl) {
		return { code: codeFromUrl, raw: trimmed };
	}

	// Голый authorization code (без пробелов, не JSON, не очевидный JWT/длинный токен только с точками)
	if (!trimmed.startsWith('{') && !/\s/.test(trimmed) && /^[A-Za-z0-9._~+/-]+=*$/.test(trimmed) && trimmed.length < 512) {
		// Эвристика: JWT-подобные access token имеют 2 точки; короткие opaque-строки считаем code
		const dotCount = (trimmed.match(/\./g) ?? []).length;
		if (dotCount < 2) {
			return { code: trimmed, raw: trimmed };
		}
	}

	return { pasteTokens: true, raw: trimmed };
}

function extractCodeFromRedirectLike(raw: string): string | undefined {
	try {
		if (/^https?:\/\//i.test(raw) || /^vscode:\/\//i.test(raw) || raw.includes('://')) {
			const u = new URL(raw);
			const code = u.searchParams.get('code')?.trim();
			if (code) {
				return code;
			}
		}
	} catch {}

	const qIdx = raw.indexOf('?');
	const query = qIdx >= 0 ? raw.slice(qIdx + 1) : raw.includes('code=') ? raw : '';
	if (query) {
		try {
			const params = new URLSearchParams(query.startsWith('http') ? new URL(query).search : query);
			const code = params.get('code')?.trim();
			if (code) {
				return code;
			}
		} catch {
			const m = /(?:^|[?&#])code=([^&]+)/.exec(raw);
			if (m?.[1]) {
				try {
					return decodeURIComponent(m[1]).trim() || undefined;
				} catch {
					return m[1].trim() || undefined;
				}
			}
		}
	}

	return undefined;
}

export interface TokenExchangeResult {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	raw: Record<string, unknown>;
}

// Authorization code + PKCE verifier -> токены через token_endpoint
export async function exchangeAuthorizationCode(params: {
	tokenUrl: string;
	code: string;
	codeVerifier: string;
	redirectUri: string;
	clientId: string;
	fetchFn?: typeof fetch;
}): Promise<TokenExchangeResult> {
	const url = params.tokenUrl.trim();
	if (!isHttpUrl(url)) {
		throw new Error('invalid_token_url');
	}

	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code: params.code,
		redirect_uri: params.redirectUri,
		client_id: params.clientId,
		code_verifier: params.codeVerifier,
	});

	const fetchFn = params.fetchFn ?? fetch.bind(globalThis);
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
		throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
	}

	let json: Record<string, unknown>;
	try {
		json = JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new Error('token_bad_json');
	}

	const accessToken = typeof json.access_token === 'string' ? json.access_token.trim() : '';
	if (!accessToken) {
		throw new Error('token_no_access');
	}

	const refreshToken = typeof json.refresh_token === 'string' && json.refresh_token.trim()
		? json.refresh_token.trim()
		: undefined;
	const expiresIn = typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)
		? Math.max(0, Math.floor(json.expires_in))
		: undefined;

	return {
		accessToken,
		...(refreshToken ? { refreshToken } : {}),
		...(expiresIn !== undefined ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
		raw: json,
	};
}
