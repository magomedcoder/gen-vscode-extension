export interface ToolFunctionSchema {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface LlmToolDefinition {
	type: 'function';
	function: ToolFunctionSchema;
}

export interface LlmToolCallFunction {
	name: string;
	arguments: string;
}

export interface LlmToolCall {
	id: string;
	type: 'function';
	function: LlmToolCallFunction;
}

export type ChatMessage = | {
		role: 'system' | 'user';
		content: string;
	}
	| {
		role: 'assistant';
		content: string | null;
		tool_calls?: LlmToolCall[];
	}
	| {
		role: 'tool';
		tool_call_id: string;
		content: string;
		name?: string;
	};

export interface CompleteParams {
	messages: ChatMessage[];
	signal?: AbortSignal;
	tools?: LlmToolDefinition[];
	toolChoice?: 'auto' | 'none' | 'required';
}

export interface CompleteResult {
	content: string;
	toolCalls?: LlmToolCall[];
	finishReason?: string;
	toolsFallback?: boolean; // если true запрос был повторен без инструментов, потому что сервер их отклонил
}

export interface ListModelsParams {
	baseUrl?: string;
	signal?: AbortSignal;
}

export interface LlmClient {
	complete(params: CompleteParams): Promise<CompleteResult>;
	listModels(params?: ListModelsParams): Promise<string[]>;
}
