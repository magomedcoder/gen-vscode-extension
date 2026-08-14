import type { ChatMessage } from '../llm/types';
import type { ChatUiMessage } from './protocol';

const SYSTEM_PROMPT = [
	'Ты Gen - помощник программиста в VS Code.',
	'Отвечай по делу, на языке пользователя.',
	'Если в запросе есть контекст редактора (файл, выделение), опирайся на него.',
].join(' ');

export function buildChatCompletionMessages(
	messages: ChatUiMessage[],
	latestUserText: string,
	editorContext?: string,
): ChatMessage[] {
	const prior = messages.filter((m): m is ChatUiMessage & {
		role: 'user' | 'assistant'
	} => m.role === 'user' || m.role === 'assistant')
		.slice(0, -1)
		.map((m) => ({
			role: m.role,
			content: m.content
		}));

	const userContent = editorContext ? `${latestUserText}\n\n---\nКонтекст редактора:\n${editorContext}` : latestUserText;

	return [
		{ 
			role: 'system',
			content: SYSTEM_PROMPT
		},
		...prior,
		{
			role: 'user',
			content: userContent
		},
	];
}
