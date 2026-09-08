import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import { buildAuthorizeUrl, discoverOAuthEndpoints, generatePkcePair, parseAuthorizationCallbackInput } from '../core/stores/mcpOAuthPkce.js';

suite('mcpOAuthPkce', () => {
	test('generatePkcePair: S256 challenge matches verifier', () => {
		const pair = generatePkcePair();
		assert.strictEqual(pair.challengeMethod, 'S256');
		assert.ok(pair.verifier.length >= 32);
		const expected = createHash('sha256')
			.update(pair.verifier)
			.digest('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');
		assert.strictEqual(pair.challenge, expected);
	});

	test('parseAuthorizationCallbackInput: code from redirect URL', () => {
		const parsed = parseAuthorizationCallbackInput(
			'https://example.com/cb?code=abc123&state=xyz',
		);
		assert.strictEqual(parsed.code, 'abc123');
		assert.ok(!parsed.pasteTokens);
	});

	test('parseAuthorizationCallbackInput: bare code', () => {
		const parsed = parseAuthorizationCallbackInput('SplxlOBeZQQYbYS6WxSbIA');
		assert.strictEqual(parsed.code, 'SplxlOBeZQQYbYS6WxSbIA');
	});

	test('parseAuthorizationCallbackInput: access token JSON -> pasteTokens', () => {
		const parsed = parseAuthorizationCallbackInput('{"access_token":"tok"}');
		assert.strictEqual(parsed.pasteTokens, true);
		assert.ok(!parsed.code);
	});

	test('buildAuthorizeUrl: includes PKCE params', () => {
		const url = buildAuthorizeUrl({
			authorizeUrl: 'https://auth.example/authorize',
			clientId: 'gen-agent-vscode',
			redirectUri: 'vscode://ext/mcp-oauth',
			codeChallenge: 'challenge',
			state: 'st',
		});
		const u = new URL(url);
		assert.strictEqual(u.searchParams.get('response_type'), 'code');
		assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
		assert.strictEqual(u.searchParams.get('code_challenge'), 'challenge');
		assert.strictEqual(u.searchParams.get('state'), 'st');
		assert.strictEqual(u.searchParams.get('client_id'), 'gen-agent-vscode');
	});

	test('discoverOAuthEndpoints: openid-configuration', async () => {
		const fetchFn = async (url: string | URL | Request) => {
			const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
			if (href.endsWith('/.well-known/openid-configuration')) {
				return new Response(JSON.stringify({
					issuer: 'https://auth.example',
					authorization_endpoint: 'https://auth.example/authorize',
					token_endpoint: 'https://auth.example/token',
				}), { status: 200, headers: { 'Content-Type': 'application/json' } });
			}
			return new Response('', { status: 404 });
		};

		const endpoints = await discoverOAuthEndpoints('https://auth.example/', { fetchFn });
		assert.strictEqual(endpoints.authorizationEndpoint, 'https://auth.example/authorize');
		assert.strictEqual(endpoints.tokenEndpoint, 'https://auth.example/token');
		assert.strictEqual(endpoints.issuer, 'https://auth.example');
	});

	test('discoverOAuthEndpoints: oauth-authorization-server fallback', async () => {
		const fetchFn = async (url: string | URL | Request) => {
			const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
			if (href.endsWith('/.well-known/openid-configuration')) {
				return new Response('', { status: 404 });
			}
			if (href.endsWith('/.well-known/oauth-authorization-server')) {
				return new Response(JSON.stringify({
					authorization_endpoint: 'https://id.example/oauth2/auth',
					token_endpoint: 'https://id.example/oauth2/token',
				}), { status: 200, headers: { 'Content-Type': 'application/json' } });
			}
			return new Response('', { status: 404 });
		};

		const endpoints = await discoverOAuthEndpoints('https://id.example', { fetchFn });
		assert.strictEqual(endpoints.authorizationEndpoint, 'https://id.example/oauth2/auth');
		assert.strictEqual(endpoints.tokenEndpoint, 'https://id.example/oauth2/token');
	});
});
