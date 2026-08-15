import type { LlmToolDefinition } from '../../llm/types';
import { parseToolArguments, toLlmToolDefinition, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { echoTool } from './echo';
import { getWorkspaceInfoTool } from './getWorkspaceInfo';

const TOOLS: ToolDefinition[] = [echoTool, getWorkspaceInfoTool];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function listAgentTools(): ToolDefinition[] {
	return TOOLS;
}

export function getAgentLlmTools(): LlmToolDefinition[] {
	return TOOLS.map(toLlmToolDefinition);
}

export async function executeAgentTool(name: string, rawArguments: string, ctx: ToolContext = {}): Promise<ToolResult> {
	const tool = BY_NAME.get(name);
	if (!tool) {
		return {
			ok: false,
			content: `Неизвестный инструмент: ${name}`,
		};
	}

	try {
		const args = parseToolArguments(rawArguments);
		return await tool.execute(args, ctx);
	} catch (err) {
		return {
			ok: false,
			content: err instanceof Error ? err.message : String(err),
		};
	}
}
