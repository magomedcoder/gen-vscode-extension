import { registerTool } from '../registry';
import { executeTool } from './execute';
import { callMcpToolTool, listMcpToolsTool } from './mcpTools';

export function registerMcpTools(): void {
	registerTool(listMcpToolsTool, {
		tags: ['mcp'],
		risk: 'mcp'
	});
	registerTool(callMcpToolTool, {
		tags: ['mcp'],
		risk: 'mcp'
	});
	registerTool(executeTool, {
		tags: ['mcp'],
		risk: 'mcp'
	});
}

