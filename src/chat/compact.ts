import * as vscode from 'vscode';
import { getSettings } from '../config/settings';
import type { LlmClient } from '../llm/types';
import type { ChatUiMessage } from './protocol';

const DEFAULT_KEEP_TURNS = 4;
const MAX_SUMMARY_INPUT = 24_000;

export interface CompactOptions {
	keepTurns?: number;
	signal?: AbortSignal;
}

export interface CompactResult {
	messages: ChatUiMessage[];
	summary?: string;
	compacted: boolean;
	reason?: string;
}

function isTurnStart(msg: ChatUiMessage): boolean {
	return msg.role === 'user';
}

// Разбить историю на ходы (каждый ход начинается с user)
export function splitIntoTurns(messages: readonly ChatUiMessage[]): ChatUiMessage[][] {
	const turns: ChatUiMessage[][] = [];
	let current: ChatUiMessage[] = [];
	for (const msg of messages) {
		if (isTurnStart(msg) && current.length > 0) {
			turns.push(current);
			current = [];
		}
		current.push(msg);
	}

	if (current.length > 0) {
		turns.push(current);
	}

	return turns;
}

function serializeTurns(turns: readonly ChatUiMessage[][]): string {
	const lines: string[] = [];
	for (const turn of turns) {
		for (const msg of turn) {
			if (msg.role === 'user') {
				lines.push(`Пользователь: ${msg.content}`);
			} else if (msg.role === 'assistant') {
				lines.push(`Ассистент: ${msg.content}`);
			} else if (msg.role === 'error') {
				lines.push(`Ошибка: ${msg.content}`);
			} else if (msg.role === 'tool') {
				lines.push(`Tool ${msg.toolName ?? ''}: ${msg.content.slice(0, 400)}`);
			}
		}
		lines.push('---');
	}
	
	const text = lines.join('\n');
	return text.length > MAX_SUMMARY_INPUT
		? `${text.slice(0, MAX_SUMMARY_INPUT)}\n\n[truncated]`
		: text;
}

function messageId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Сжать старые ходы в одно summary-сообщение, оставить последние N ходов
export async function compactChatMessages(
	messages: readonly ChatUiMessage[],
	client: LlmClient,
	opts?: CompactOptions,
): Promise<CompactResult> {
	const keepTurns = Math.max(1, opts?.keepTurns ?? DEFAULT_KEEP_TURNS);
	const turns = splitIntoTurns(messages);
	if (turns.length <= keepTurns) {
		return {
			messages: [...messages],
			compacted: false,
			reason: vscode.l10n.t('chat.compact.nothingToDo', keepTurns),
		};
	}

	const older = turns.slice(0, -keepTurns);
	const recent = turns.slice(-keepTurns);
	const settings = getSettings();
	const model = settings.smallModel.trim() || undefined;
	const prompt = [
		'Суммируй предыдущую переписку чата для coding-агента.',
		'Сохрани: цель задачи, принятые решения, ключевые пути файлов, незавершённые шаги.',
		'Пиши кратко, на языке пользователя, без воды.',
		'',
		serializeTurns(older),
	].join('\n');

	const result = await client.complete({
		messages: [
			{
				role: 'system',
				content: 'Ты сжимаешь историю чата. Ответь только текстом summary.',
			},
			{
				role: 'user',
				content: prompt,
			},
		],
		model,
		signal: opts?.signal,
		toolChoice: 'none',
	});

	const summary = result.content.trim();
	if (!summary) {
		return {
			messages: [...messages],
			compacted: false,
			reason: vscode.l10n.t('chat.compact.emptySummary'),
		};
	}

	const summaryMsg: ChatUiMessage = {
		id: messageId(),
		role: 'assistant',
		content: vscode.l10n.t('chat.compact.summaryPrefix', summary),
	};

	return {
		messages: [summaryMsg, ...recent.flat()],
		summary,
		compacted: true,
	};
}
