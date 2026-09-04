import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as vscode from 'vscode';
import { getSettings } from '../config/settings';

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
	enabled: boolean;
}

export interface McpToolInfo {
	server: string;
	name: string;
	description?: string;
	inputSchema?: object;
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
	readonly name: string;

	constructor(cfg: McpServerConfig) {
		this.name = cfg.name;
		this.proc = spawn(cfg.command, cfg.args ?? [], {
			stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				...process.env,
				...cfg.env
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
			}, 30_000);
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
		const servers = getSettings().mcpServers ?? [];
		for (const cfg of servers) {
			if (!cfg.enabled || cfg.transport !== 'stdio' || !cfg.command) {
				continue;
			}

			try {
				const conn = new StdioMcpConnection(cfg);
				await conn.initialize();
				this.connections.set(cfg.name, conn);
			} catch (err) {
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

	status(): Array<{ name: string; connected: boolean; toolCount: number }> {
		const servers = getSettings().mcpServers ?? [];
		return servers.map((s) => {
			const c = this.connections.get(s.name);
			return {
				name: s.name,
				connected: Boolean(c),
				toolCount: c?.listTools().length ?? 0,
			};
		});
	}
}

let manager: McpManager | undefined;

export function getMcpManager(): McpManager {
	if (!manager) {
		manager = new McpManager();
	}
	
	return manager;
}
