import type { LlmToolDefinition } from '../llm/types';

export interface ToolContext {
	signal?: AbortSignal;
}

export interface ToolResult {
	ok: boolean;
	content: string;
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export function toLlmToolDefinition(tool: ToolDefinition): LlmToolDefinition {
	return {
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	};
}

export function parseToolArguments(raw: string): Record<string, unknown> {
	const trimmed = raw.trim() || '{}';
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		
		return { value: parsed };
	} catch (err) {
		throw new Error(`Некорректный JSON аргументов инструмента: ${err instanceof Error ? err.message : String(err)}`);
	}
}
