import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as vscode from 'vscode';
import { interpolateConfigString } from '../core/config/interpolate';
import { getSettings } from '../core/config/settings';
import { getMcpOAuthDebugInfo, getMcpOAuthTokens } from '../core/stores/mcpOAuthStore';
import type { McpOAuthDebugInfo } from '../core/stores/mcpOAuthStore';

const EXTENSION_ID = 'magomedcoder.gen-agent-vscode';

function extensionVersion(): string {
	const version = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.version;
	return typeof version === 'string' && version.trim() ? version.trim() : '0.0.0';
}

export interface McpServerConfig {
	name: string;
	transport: 'stdio';
	command: string;
	args?: string[];
	env?: Record<string, string>;
	// Заголовки: для stdio пробрасываются как GEN_MCP_HEADER_* (и в env, если ключ похож на имя переменной); будущий HTTP-транспорт будет слать их как HTTP-заголовки.
	headers?: Record<string, string>;
	cwd?: string;
	timeoutMs?: number;
	enabled: boolean;
	/**
	 * Запросить OAuth для сервера. По умолчанию false / omit.
	 * MVP: paste-token / optional authorize URL; полный OIDC - WIP. stdio без oauth не ломаем.
	 */
	oauth?: boolean;
	/**
	 * Опциональный URL авторизации (placeholder для будущего OIDC).
	 * При Auth открывается через vscode.env.openExternal, если задан.
	 */
	mcpOAuthAuthorizeUrl?: string;
}

/**
 * Если oauth:true и есть accessToken - Bearer в headers + MCP_OAUTH_TOKEN в env.
 * Для будущего HTTP-транспорта headers уже готовы; stdio * GEN_MCP_HEADER_*.
 */
export async function applyMcpOAuthToConfig(cfg: McpServerConfig): Promise<McpServerConfig> {
	if (cfg.oauth !== true) {
		return cfg;
	}

	const tokens = await getMcpOAuthTokens(cfg.name);
	const accessToken = tokens?.accessToken?.trim();
	if (!accessToken) {
		return cfg;
	}

	const bearer = `Bearer ${accessToken}`;
	const headers: Record<string, string> = {
		...(cfg.headers ?? {}),
		Authorization: bearer,
	};
	const env: Record<string, string> = {
		...(cfg.env ?? {}),
		MCP_OAUTH_TOKEN: accessToken,
	};
	return { 
		...cfg, 
		headers, 
		env 
	};
}

// Имя заголовка * безопасный суффикс для GEN_MCP_HEADER_*
function sanitizeHeaderEnvKey(key: string): string {
	return key.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
}

// Ключ похож на имя env-переменной (можно мержить напрямую в env)
function looksLikeEnvKey(key: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

export interface McpToolInfo {
	server: string;
	name: string;
	description?: string;
	inputSchema?: object;
}

// Статус одного MCP-сервера для настроек и list_mcp_tools
export interface McpServerStatus {
	name: string;
	enabled: boolean;
	connected: boolean;
	toolCount: number;
	tools: Array<{ 
		name: string; 
		description?: string 
	}>;
	error?: string;
	// В конфиге oauth:true
	oauthRequested?: boolean;
	// Debug OAuth без сырого токена (только при oauth:true)
	oauth?: McpOAuthDebugInfo;
}

interface JsonRpcMessage {
	jsonrpc: '2.0';
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { 
		code: number
		message: string
	};
}

class StdioMcpConnection {
	private proc: ChildProcessWithoutNullStreams;
	private nextId = 1;
	private buffer = '';
	private pending = new Map<number, { 
		resolve: (v: unknown) => void
		reject: (e: Error) => void 
	}>();
	private tools: McpToolInfo[] = [];
	private readonly requestTimeoutMs: number;
	readonly name: string;

	constructor(cfg: McpServerConfig) {
		this.name = cfg.name;
		this.requestTimeoutMs = cfg.timeoutMs && cfg.timeoutMs >= 1000 ? cfg.timeoutMs : 30_000;
		// Подстановка ${env:...} / {env:...} / {file:...} в command, args, env, cwd
		const interpOpts = {
			cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
		};
		const command = interpolateConfigString(cfg.command, interpOpts);
		const args = (cfg.args ?? []).map((a) => interpolateConfigString(a, interpOpts));
		const cwd = cfg.cwd ? interpolateConfigString(cfg.cwd, interpOpts) : undefined;
		const env: Record<string, string> = {};
		if (cfg.env) {
			for (const [key, value] of Object.entries(cfg.env)) {
				env[key] = interpolateConfigString(value, interpOpts);
			}
		}

		// headers * GEN_MCP_HEADER_* для stdio; если ключ похож на env - ещё и напрямую в env
		if (cfg.headers) {
			for (const [key, value] of Object.entries(cfg.headers)) {
				const interpolated = interpolateConfigString(value, interpOpts);
				env[`GEN_MCP_HEADER_${sanitizeHeaderEnvKey(key)}`] = interpolated;
				if (looksLikeEnvKey(key)) {
					env[key] = interpolated;
				}
			}
		}

		this.proc = spawn(command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: cwd || undefined,
			env: {
				...process.env,
				...env,
			},
		});
		this.proc.stdout.setEncoding('utf8');
		this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));
		this.proc.on('error', (err) => {
			for (const p of this.pending.values()) {
				p.reject(err);
			}

			this.pending.clear();
		});
		this.proc.on('exit', () => {
			for (const p of this.pending.values()) {
				p.reject(new Error(`MCP-сервер ${this.name} завершился`));
			}

			this.pending.clear();
		});
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		let idx: number;
		while ((idx = this.buffer.indexOf('\n')) >= 0) {
			const line = this.buffer.slice(0, idx).trim();
			this.buffer = this.buffer.slice(idx + 1);
			if (!line) {
				continue;
			}

			try {
				const msg = JSON.parse(line) as JsonRpcMessage;
				if (msg.id !== undefined && this.pending.has(Number(msg.id))) {
					const p = this.pending.get(Number(msg.id))!;
					this.pending.delete(Number(msg.id));
					if (msg.error) {
						p.reject(new Error(msg.error.message));
					} else {
						p.resolve(msg.result);
					}
				}
			} catch {}
		}
	}

	private request(method: string, params?: unknown): Promise<unknown> {
		const id = this.nextId++;
		const payload: JsonRpcMessage = { 
			jsonrpc: '2.0', 
			id, 
			method, 
			params 
		};
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.proc.stdin.write(`${JSON.stringify(payload)}\n`, (err) => {
				if (err) {
					this.pending.delete(id);
					reject(err);
				}
			});
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`MCP ${this.name}: таймаут на ${method}`));
				}
			}, this.requestTimeoutMs);
		});
	}

	async initialize(): Promise<void> {
		await this.request('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { 
				name: 'gen-agent-vscode', 
				version: extensionVersion(),
			},
		});
		this.proc.stdin.write(`${JSON.stringify({ 
			jsonrpc: '2.0', 
			method: 'notifications/initialized' 
		})}\n`);
		const listed = await this.request('tools/list', {}) as {
			tools?: Array<{
				name: string
				description?: string
				inputSchema?: object
			}> };
		this.tools = (listed.tools ?? []).map((t) => ({
			server: this.name,
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema,
		}));
	}

	listTools(): McpToolInfo[] {
		return this.tools;
	}

	async callTool(name: string, args: unknown): Promise<string> {
		const result = await this.request('tools/call', { name, arguments: args ?? {} }) as {
			content?: Array<{ 
				type: string; 
				text?: string 
			}>;
			isError?: boolean;
		};

		const text = (result.content ?? []).map((c) => c.text ?? '').filter(Boolean).join('\n');
		if (result.isError) {
			throw new Error(text || 'Ошибка MCP tool');
		}

		return text || JSON.stringify(result);
	}

	dispose(): void {
		try {
			this.proc.kill();
		} catch {}
	}
}

class McpManager {
	private connections = new Map<string, StdioMcpConnection>();
	// Последняя ошибка подключения по имени сервера
	private lastErrors = new Map<string, string>();
	private connecting?: Promise<void>;

	async refresh(): Promise<void> {
		if (this.connecting) {
			return this.connecting;
		}

		this.connecting = this.refreshInner().finally(() => {
			this.connecting = undefined;
		});
		return this.connecting;
	}

	private async refreshInner(): Promise<void> {
		for (const c of this.connections.values()) {
			c.dispose();
		}

		this.connections.clear();
		this.lastErrors.clear();
		const servers = getSettings().mcpServers ?? [];
		for (const cfg of servers) {
			if (!cfg.enabled || cfg.transport !== 'stdio' || !cfg.command) {
				continue;
			}

			try {
				// oauth:true + токен * Bearer / MCP_OAUTH_TOKEN; иначе cfg без изменений
				const cfgReady = await applyMcpOAuthToConfig(cfg);
				const conn = new StdioMcpConnection(cfgReady);
				await conn.initialize();
				this.connections.set(cfg.name, conn);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.lastErrors.set(cfg.name, message);
				console.error(`MCP ${cfg.name} ошибка:`, err);
			}
		}
	}

	listTools(): McpToolInfo[] {
		const out: McpToolInfo[] = [];
		for (const c of this.connections.values()) {
			out.push(...c.listTools());
		}

		return out;
	}

	async callTool(server: string, toolName: string, args: unknown): Promise<string> {
		await this.refresh();
		const conn = this.connections.get(server);
		if (!conn) {
			throw new Error(`MCP-сервер не подключён: ${server}`);
		}

		return conn.callTool(toolName, args);
	}

	async status(): Promise<McpServerStatus[]> {
		const servers = getSettings().mcpServers ?? [];
		const out: McpServerStatus[] = [];
		for (const s of servers) {
			const c = this.connections.get(s.name);
			const tools = (c?.listTools() ?? []).map((t) => ({
				name: t.name,
				description: t.description,
			}));
			const error = this.lastErrors.get(s.name);
			const row: McpServerStatus = {
				name: s.name,
				enabled: Boolean(s.enabled),
				connected: Boolean(c),
				toolCount: tools.length,
				tools,
				...(error ? { error } : {}),
			};
			if (s.oauth === true) {
				row.oauthRequested = true;
				// Debug без сырого токена
				row.oauth = await getMcpOAuthDebugInfo(s.name);
			}
			out.push(row);
		}
		return out;
	}
}

let manager: McpManager | undefined;

export function getMcpManager(): McpManager {
	if (!manager) {
		manager = new McpManager();
	}
	
	return manager;
}
