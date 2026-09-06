import { getSettings } from '../../config/settings';
import { getMcpManager } from '../../integrations/mcpClient';
import { suggestPattern } from '../permissionPolicy';
import { asString } from '../types';
import type { ToolContext, ToolDefinition, ToolResult } from '../types';
import { throwIfAborted } from '../workspacePath';
import { confirmAlwaysOrSkip } from './confirm';

// Лимит шагов code-mode (защита от разгона)
export const CODE_MODE_MAX_STEPS = 32;

export interface CodeModeStep {
	tool: string;
	arguments?: Record<string, unknown>;
}

/**
 * Разбор `server__toolName` (первый `__` - разделитель).
 * Имя сервера и tool непустые; произвольный JS / другие форматы отклоняются.
 */
export function parseMcpToolRef(ref: string): { server: string; toolName: string } | undefined {
	const trimmed = ref.trim();
	const sep = trimmed.indexOf('__');
	if (sep <= 0 || sep >= trimmed.length - 2) {
		return undefined;
	}

	const server = trimmed.slice(0, sep).trim();
	const toolName = trimmed.slice(sep + 2).trim();
	if (!server || !toolName || server.includes('/') || toolName.includes('/')) {
		return undefined;
	}

	return { server, toolName };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Нормализация script / steps * массив шагов.
 * Допускается только JSON-массив объектов `{ tool, arguments? }` - без eval/JS.
 */
export function parseCodeModeSteps(args: Record<string, unknown>): CodeModeStep[] | { error: string } {
	let raw: unknown = args.steps;
	if (raw === undefined && typeof args.script === 'string') {
		const script = args.script.trim();
		if (!script) {
			return { 
				error: 'execute: пустой script' 
			};
		}

		try {
			raw = JSON.parse(script) as unknown;
		} catch {
			return { 
				error: 'execute: script должен быть JSON-массивом шагов (не произвольный JS)' 
			};
		}
	}

	if (!Array.isArray(raw)) {
		return { 
			error: 'execute: нужен steps (массив) или script (JSON-массив)' 
		};
	}

	if (raw.length === 0) {
		return { 
			error: 'execute: пустой список шагов' 
		};
	}

	if (raw.length > CODE_MODE_MAX_STEPS) {
		return { 
			error: `execute: максимум ${CODE_MODE_MAX_STEPS} шагов за вызов` 
		};
	}

	const steps: CodeModeStep[] = [];
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i];
		if (!isPlainObject(item)) {
			return { 
				error: `execute: шаг ${i + 1} должен быть объектом { tool, arguments? }` 
			};
		}

		const tool = typeof item.tool === 'string' ? item.tool.trim() : '';
		if (!tool) {
			return { 
				error: `execute: шаг ${i + 1}: нужно непустое tool (формат server__toolName)` 
			};
		}

		if (!parseMcpToolRef(tool)) {
			return {
				error: `execute: шаг ${i + 1}: tool должен быть «server__toolName» (первый __ - разделитель), получено: ${tool}`,
			};
		}

		let stepArgs: Record<string, unknown> | undefined;
		if (item.arguments !== undefined) {
			if (!isPlainObject(item.arguments)) {
				return { error: `execute: шаг ${i + 1}: arguments должен быть объектом JSON` };
			}

			stepArgs = item.arguments;
		}

		// Только объявленные поля - никаких других ключей как «кода»
		steps.push({ tool, arguments: stepArgs });
	}

	return steps;
}

export const executeTool: ToolDefinition = {
	name: 'execute',
	description:'Experimental code-mode: выполнить последовательность вызовов MCP tools. Только JSON-шаги [{ "tool": "server__toolName", "arguments": {} }, ...] - без произвольного JS/eval на хосте. Сначала list_mcp_tools. Включается настройкой codeModeEnabled.',
	parameters: {
		type: 'object',
		properties: {
			steps: {
				type: 'array',
				description: 'JSON-массив шагов { tool: "server__toolName", arguments?: object }',
				items: {
					type: 'object',
					properties: {
						tool: {
							type: 'string',
							description: 'Имя MCP tool как server__toolName',
						},
						arguments: {
							type: 'object',
							description: 'JSON-аргументы tool',
						},
					},
					required: ['tool'],
					additionalProperties: false,
				},
			},
			script: {
				type: 'string',
				description: 'Альтернатива steps: JSON-строка того же массива шагов (не JS)',
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const settings = getSettings();
		if (!settings.codeModeEnabled) {
			return {
				ok: false,
				content: 'execute: выключен (experimental code-mode). Включите codeModeEnabled в настройках MCP.',
			};
		}

		const parsed = parseCodeModeSteps(args);
		if ('error' in parsed) {
			return { 
				ok: false, 
				content: parsed.error 
			};
		}

		const ext = ctx as ToolContext & { 
			suggestAlwaysPattern?: string; skipConfirm?: boolean };
		const results: Array<{
			index: number;
			tool: string;
			server: string;
			toolName: string;
			ok: boolean;
			denied?: boolean;
			content: string;
		}> = [];

		for (let i = 0; i < parsed.length; i++) {
			throwIfAborted(ctx.signal);
			const step = parsed[i]!;
			const ref = parseMcpToolRef(step.tool)!;
			const { server, toolName } = ref;
			const subject = `${server}/${toolName}`;
			ext.suggestAlwaysPattern = suggestPattern('mcp', 'call_mcp_tool', subject);

			const denied = await confirmAlwaysOrSkip(
				ctx,
				`MCP ${server}/${toolName}`,
				JSON.stringify(step.arguments ?? {}),
			);
			if (denied) {
				results.push({
					index: i + 1,
					tool: step.tool,
					server,
					toolName,
					ok: false,
					denied: true,
					content: denied.content,
				});
				return {
					ok: false,
					denied: true,
					content: JSON.stringify({
						mode: 'code-mode',
						stoppedAt: i + 1,
						results,
					}, null, 2),
				};
			}

			try {
				const out = await getMcpManager().callTool(server, toolName, step.arguments ?? {});
				results.push({
					index: i + 1,
					tool: step.tool,
					server,
					toolName,
					ok: true,
					content: out,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				results.push({
					index: i + 1,
					tool: step.tool,
					server,
					toolName,
					ok: false,
					content: message,
				});
				return {
					ok: false,
					content: JSON.stringify({
						mode: 'code-mode',
						stoppedAt: i + 1,
						results,
					}, null, 2),
				};
			}
		}

		return {
			ok: true,
			content: JSON.stringify({
				mode: 'code-mode',
				steps: results.length,
				results,
			}, null, 2),
		};
	},
};

// Subject для permission / activity: первый шаг или имя tool
export function executeSubjectFromArgs(rawArguments: string): string | undefined {
	try {
		const args = JSON.parse(rawArguments) as Record<string, unknown>;
		const parsed = parseCodeModeSteps(args);
		if ('error' in parsed || parsed.length === 0) {
			return undefined;
		}

		const ref = parseMcpToolRef(parsed[0]!.tool);
		return ref ? `${ref.server}/${ref.toolName}` : undefined;
	} catch {
		return undefined;
	}
}

// Для subjectFromArgs call_mcp_tool
export function mcpCallSubjectFromArgs(args: Record<string, unknown>): string | undefined {
	const server = asString(args, 'server').trim();
	const toolName = asString(args, 'toolName').trim();
	if (server && toolName) {
		return `${server}/${toolName}`;
	}

	return undefined;
}
