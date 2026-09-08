import * as vscode from 'vscode';
import { clearMcpOAuthPkceSession, getMcpOAuthPkceSessionByState, setMcpOAuthLastError, setMcpOAuthTokens } from '../core/stores/mcpOAuthStore';
import { exchangeAuthorizationCode } from '../core/stores/mcpOAuthPkce';
import { getMcpManager } from './mcpClient';

const CALLBACK_PATH = '/mcp-oauth';

/**
 * VS Code UriHandler для callback MCP OAuth authorization_code.
 *
 * Redirect: `vscode://<extensionId>/mcp-oauth?code=...&state=...` (через `vscode.env.asExternalUri`).
 *
 * Ограничения / оговорки (для операторов):
 * - Некоторые IdP запрещают custom `vscode://` redirect URI; paste `code` или redirect URL всё ещё работает.
 * - Если позже понадобится публичный https redirect proxy - сохранять PKCE + paste-путь.
 */
export function registerMcpOAuthUriHandler(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.window.registerUriHandler({
		async handleUri(uri: vscode.Uri): Promise<void> {
			const path = uri.path || '';
			if (path !== CALLBACK_PATH && path !== CALLBACK_PATH.slice(1)) {
				// Допускать path с/без ведущего слэша (варианты asExternalUri)
				if (!path.endsWith('mcp-oauth')) {
					return;
				}
			}

			const params = new URLSearchParams(uri.query);
			const code = params.get('code')?.trim();
			const state = params.get('state')?.trim();
			const err = params.get('error')?.trim();

			if (err) {
				const desc = params.get('error_description')?.trim() || err;
				void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.callbackError', desc));
				return;
			}

			if (!code || !state) {
				void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.callbackMissingCode'));
				return;
			}

			const session = await getMcpOAuthPkceSessionByState(state);
			if (!session) {
				void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.callbackUnknownState'));
				return;
			}

			try {
				const tokens = await exchangeAuthorizationCode({
					tokenUrl: session.tokenUrl,
					code,
					codeVerifier: session.codeVerifier,
					redirectUri: session.redirectUri,
					clientId: session.clientId,
				});
				await setMcpOAuthTokens(session.serverName, {
					accessToken: tokens.accessToken,
					...(tokens.refreshToken ? { 
						refreshToken: tokens.refreshToken 
					} : {}),
					...(tokens.expiresAt !== undefined ? { 
						expiresAt: tokens.expiresAt 
					} : {}),
					meta: { 
						client_id: session.clientId 
					},
				});
				await clearMcpOAuthPkceSession(session.serverName);
				setMcpOAuthLastError(session.serverName, undefined);
				void vscode.window.showInformationMessage(
					vscode.l10n.t('mcp.oauth.tokenSaved', session.serverName),
				);
				void getMcpManager().refresh();
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				setMcpOAuthLastError(session.serverName, message);
				void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.codeExchangeFailed', message));
			}
		},
	});
}

// Собрать redirect URI для PKCE authorize (путь UriHandler)
export async function buildMcpOAuthRedirectUri(extensionId: string): Promise<string> {
	const base = vscode.Uri.parse(`${vscode.env.uriScheme}://${extensionId}${CALLBACK_PATH}`);
	const external = await vscode.env.asExternalUri(base);
	return external.toString(true);
}
