import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';
import { getMcpManager } from '../../../../integrations/mcpClient';
import { confirmAlwaysOrSkip } from '../confirm';

export const listMcpToolsTool: ToolDefinition = {
	name: 'list_mcp_tools',
	description: 'Список подключённых MCP-серверов и их tools.',
	parameters: {
		type: 'object',
		properties: {},
		additionalProperties: false
	},
	async execute(_args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const mcp = getMcpManager();
		await mcp.refresh();
		return {
			ok: true,
			content: JSON.stringify({
				status: await mcp.status(),
				tools: mcp.listTools(),
			}, null, 2),
		};
	},
};

export const callMcpToolTool: ToolDefinition = {
	name: 'call_mcp_tool',
	description: 'Вызвать tool на MCP-сервере (stdio). Сначала list_mcp_tools.',
	parameters: {
		type: 'object',
		properties: {
			server: {
				type: 'string'
			},
			toolName: {
				type: 'string'
			},
			arguments: {
				type: 'object'
			},
		},
		required: ['server', 'toolName'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const server = asString(args, 'server').trim();
		const toolName = asString(args, 'toolName').trim();
		if (!server || !toolName) {
			return {
				ok: false,
				content: 'call_mcp_tool: нужны server и toolName'
			};
		}

		const denied = await confirmAlwaysOrSkip(ctx, `MCP ${server}/${toolName}`, JSON.stringify(args.arguments ?? {}));
		if (denied) {
			return denied;
		}

		try {
			const out = await getMcpManager().callTool(server, toolName, args.arguments ?? {}, ctx.signal);
			return {
				ok: true,
				content: out
			};
		} catch (err) {
			return {
				ok: false,
				content: err instanceof Error ? err.message : String(err)
			};
		}
	},
};
