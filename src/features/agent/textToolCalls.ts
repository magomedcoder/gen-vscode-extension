import type { LlmToolCall } from '../../core/llm/types';

// Формат в стиле Qwen / Hermes: <tool_call><function=name><parameter=k>v</parameter></function></tool_call>
const TOOL_CALL_BLOCK = /<tool_call>\s*<function=([a-zA-Z0-9_.-]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/gi;

const PARAMETER_BLOCK = /<parameter=([a-zA-Z0-9_.-]+)>\s*([\s\S]*?)\s*<\/parameter>/gi;

// Незакрытый хвост при стриминге - прячем из UI
const INCOMPLETE_TOOL_CALL_TAIL = /<tool_call>[\s\S]*$/i;

// Имя tool как есть (trim); без remap чужих алиасов
export function normalizeTextToolName(name: string): string {
	return name.trim();
}

function parametersToJson(body: string): string {
	const args: Record<string, string> = {};
	PARAMETER_BLOCK.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = PARAMETER_BLOCK.exec(body)) !== null) {
		const key = match[1]?.trim();
		if (!key) {
			continue;
		}

		args[key] = (match[2] ?? '').trim();
	}

	return JSON.stringify(args);
}

export interface ExtractTextToolCallsResult {
	// Текст без разобранных <tool_call> блоков (для UI)
	content: string;
	toolCalls: LlmToolCall[];
}

/**
 * Достаёт текстовые tool_call из content модели и убирает их из строки.
 * Если native tool_calls уже есть - всё равно чистит XML из content.
 */
export function extractTextToolCalls(raw: string): ExtractTextToolCallsResult {
	if (!raw || !/<tool_call>/i.test(raw)) {
		return {
			content: raw,
			toolCalls: [],
		};
	}

	const toolCalls: LlmToolCall[] = [];
	TOOL_CALL_BLOCK.lastIndex = 0;
	const content = raw.replace(TOOL_CALL_BLOCK, (_full, rawName: string, body: string) => {
		const name = normalizeTextToolName(String(rawName ?? ''));
		if (!name) {
			return '';
		}

		toolCalls.push({
			id: `text_call_${toolCalls.length + 1}`,
			type: 'function',
			function: {
				name,
				arguments: parametersToJson(String(body ?? '')),
			},
		});
		return '';
	});

	return {
		content: content.replace(/\n{3,}/g, '\n\n').trim(),
		toolCalls,
	};
}

// Для стрима: убрать завершённые блоки и незакрытый хвост <tool_call>....
export function stripTextToolCallsForDisplay(raw: string): string {
	if (!raw || !/<tool_call>/i.test(raw)) {
		return raw;
	}

	const { content } = extractTextToolCalls(raw);
	return content.replace(INCOMPLETE_TOOL_CALL_TAIL, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}
