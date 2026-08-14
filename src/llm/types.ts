export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface CompleteParams {
	messages: ChatMessage[];
	signal?: AbortSignal;
}

export interface CompleteResult {
	content: string;
}

export interface ListModelsParams {
	baseUrl?: string;
	signal?: AbortSignal;
}

export interface LlmClient {
	complete(params: CompleteParams): Promise<CompleteResult>;
	listModels(params?: ListModelsParams): Promise<string[]>;
}
