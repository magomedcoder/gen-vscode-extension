import type { GenSettings } from '../config/types';
import { getCachedNCtx, getEffectiveContextBudget, isNearContextBudget, isOverContextBudget, setCachedNCtx } from '../llm/contextBudget';
import { ContextBudgetExceededError, formatContextOverflowUserMessage, parseContextOverflow } from '../llm/contextOverflow';
import type { ContextOverflowInfo } from '../llm/contextOverflow';
import { estimateChatMessagesTokens } from '../llm/estimateTokens';
import type { ChatContentPart, ChatMessage, CompleteResult, LlmClient } from '../llm/types';
import * as vscode from 'vscode';

export const MAX_CONTEXT_OVERFLOW_RETRIES = 2;

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}

	return `${text.slice(0, Math.max(0, maxChars - 32))}\n...[truncated ${text.length - maxChars} chars]`;
}

function truncateContent(
	content: string | ChatContentPart[] | null,
	maxChars: number,
): string | ChatContentPart[] | null {
	if (content === null || content === undefined) {
		return content;
	}

	if (typeof content === 'string') {
		return truncateText(content, maxChars);
	}

	return content.map((part) => {
		if (part.type === 'text') {
			return {
				type: 'text' as const,
				text: truncateText(part.text, maxChars)
			};
		}

		return part;
	});
}

function cloneMessages(messages: readonly ChatMessage[]): ChatMessage[] {
	return messages.map((m) => {
		if (m.role === 'assistant') {
			return {
				role: 'assistant',
				content: m.content,
				...(m.tool_calls ? {
					tool_calls: m.tool_calls.map((c) => ({ 
						...c, function: { 
							...c.function
						}
					}))
				} : {}),
			};
		}

		if (m.role === 'tool') {
			return { ...m };
		}

		return {
			role: m.role,
			content: m.content
		} as ChatMessage;
	});
}

/**
 * Ужать apiMessages под budget: truncate tool/user/assistant, затем выкинуть старые пары из середины.
 * System (первый) и хвост диалога сохраняются.
 */
export function shrinkApiMessages(
	messages: readonly ChatMessage[],
	budget: number,
	settings: GenSettings,
): { messages: ChatMessage[]; changed: boolean } {
	let current = cloneMessages(messages);
	let changed = false;
	const toolCap = Math.max(400, Math.min(settings.toolOutputMaxChars || 12_000, 4_000));

	const applyCaps = (cap: number): void => {
		for (let i = 0; i < current.length; i += 1) {
			const msg = current[i];
			if (msg.role === 'system' && i === 0) {
				continue;
			}

			if (msg.role === 'tool') {
				const next = truncateText(msg.content, cap);
				if (next !== msg.content) {
					current[i] = { ...msg, content: next };
					changed = true;
				}

				continue;
			}

			if (msg.role === 'user' || msg.role === 'assistant') {
				const max = msg.role === 'user' ? Math.max(cap, settings.maxInputChars) : cap * 2;
				const nextContent = truncateContent(msg.content, max);
				if (JSON.stringify(nextContent) !== JSON.stringify(msg.content)) {
					current[i] = { ...msg, content: nextContent } as ChatMessage;
					changed = true;
				}
			}
		}
	};

	applyCaps(toolCap);
	if (!isOverContextBudget(estimateChatMessagesTokens(current), budget)) {
		return { 
			messages: current, 
			changed 
		};
	}

	applyCaps(Math.max(200, Math.floor(toolCap / 3)));
	if (!isOverContextBudget(estimateChatMessagesTokens(current), budget)) {
		return { 
			messages: current, 
			changed 
		};
	}

	// Удаляем сообщения из середины (после system), пока не влезем или не останется хвост
	const keepTail = 8;
	while (current.length > keepTail + 1 && isOverContextBudget(estimateChatMessagesTokens(current), budget)) {
		// index 0 = system; удаляем самый старый non-system
		current.splice(1, 1);
		changed = true;
	}

	return { messages: current, changed };
}

export function resolveContextBudget(settings: GenSettings): number {
	return getEffectiveContextBudget(
		settings,
		getCachedNCtx(settings.baseUrl, settings.model),
	);
}

export function rememberOverflowNCtx(settings: GenSettings, info: ContextOverflowInfo): void {
	if (info.nCtx) {
		setCachedNCtx(settings.baseUrl, settings.model, info.nCtx);
	}
}

export function throwFriendlyOverflow(info: ContextOverflowInfo, budget: number): never {
	throw new ContextBudgetExceededError(formatContextOverflowUserMessage(info, budget));
}

export function throwPreflightOverflow(estimated: number, budget: number, nCtx?: number): never {
	throw new ContextBudgetExceededError(vscode.l10n.t('chat.contextOverflow.preflight', estimated, budget, nCtx ?? '-'));
}

export interface CompleteWithContextGuardOptions {
	client: LlmClient;
	settings: GenSettings;
	getMessages: () => ChatMessage[];
	setMessages: (messages: ChatMessage[]) => void;
	complete: (messages: ChatMessage[]) => Promise<CompleteResult>;
	// Уведомление UI о retry/compact
	onStatus?: (detail: string) => void;
	signal?: AbortSignal;
}

// Preflight shrink + reactive overflow retry вокруг одного complete()
export async function completeWithContextGuard(opts: CompleteWithContextGuardOptions): Promise<CompleteResult> {
	const policy = opts.settings.contextOverflowPolicy;
	let retries = 0;

	while (true) {
		if (opts.signal?.aborted) {
			const err = new Error('Aborted');
			err.name = 'AbortError';
			throw err;
		}

		const settings = opts.settings;
		let messages = opts.getMessages();
		const budget = resolveContextBudget(settings);
		let estimated = estimateChatMessagesTokens(messages);

		if (isNearContextBudget(estimated, budget) || isOverContextBudget(estimated, budget)) {
			if (policy === 'fail_fast' && isOverContextBudget(estimated, budget)) {
				throwPreflightOverflow(estimated, budget, getCachedNCtx(settings.baseUrl, settings.model));
			}

			if (policy !== 'fail_fast') {
				opts.onStatus?.(vscode.l10n.t('chat.contextOverflow.shrinking'));
				const shrunk = shrinkApiMessages(messages, budget, settings);
				if (shrunk.changed) {
					opts.setMessages(shrunk.messages);
					messages = shrunk.messages;
					estimated = estimateChatMessagesTokens(messages);
				}
			}

			if (isOverContextBudget(estimated, budget)) {
				if (policy === 'ask' || policy === 'fail_fast') {
					throwPreflightOverflow(
						estimated,
						budget,
						getCachedNCtx(settings.baseUrl, settings.model),
					);
				}
				// auto: всё равно пробуем HTTP - сервер точнее; reactive подхватит
			}
		}

		try {
			return await opts.complete(messages);
		} catch (err) {
			const info = parseContextOverflow(err);
			if (!info) {
				throw err;
			}

			rememberOverflowNCtx(settings, info);
			const newBudget = resolveContextBudget(settings);

			if (policy === 'fail_fast' || policy === 'ask') {
				throwFriendlyOverflow(info, newBudget);
			}

			if (retries >= MAX_CONTEXT_OVERFLOW_RETRIES) {
				throwFriendlyOverflow(info, newBudget);
			}

			retries += 1;
			opts.onStatus?.(
				vscode.l10n.t('chat.contextOverflow.retrying', retries, MAX_CONTEXT_OVERFLOW_RETRIES),
			);

			const shrunk = shrinkApiMessages(opts.getMessages(), newBudget, settings);
			opts.setMessages(shrunk.messages);
			if (!shrunk.changed && estimateChatMessagesTokens(shrunk.messages) > newBudget) {
				throwFriendlyOverflow(info, newBudget);
			}
		}
	}
}
