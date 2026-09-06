import * as vscode from 'vscode';
import { LlmHttpError } from './errors';

export interface ContextOverflowInfo {
	nPromptTokens?: number;
	nCtx?: number;
	message: string;
	raw: string;
}

const OVERFLOW_TYPE_RE = /exceed_context_size_error|context[_ ]?(?:length|window|size)\s*(?:exceeded|too large)|maximum context length|prompt is too long|n_ctx/i;
const N_PROMPT_RE = /n_prompt_tokens["']?\s*[:=]\s*(\d+)/i;
const N_CTX_RE = /n_ctx["']?\s*[:=]\s*(\d+)/i;
const REQUEST_EXCEEDS_RE = /request\s*\((\d+)\s*tokens?\)\s*exceeds.*?context size\s*\((\d+)\s*tokens?\)/i;

function collectStrings(value: unknown, out: string[], depth: number): void {
	if (depth > 6 || value === null || value === undefined) {
		return;
	}
	
	if (typeof value === 'string') {
		out.push(value);
		// Вложенный JSON в message (llama.cpp / engine protocol)
		const trimmed = value.trim();
		if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 50_000) {
			try {
				collectStrings(JSON.parse(trimmed) as unknown, out, depth + 1);
			} catch {}
		}
		return;
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectStrings(item, out, depth + 1);
		}
		return;
	}

	if (typeof value === 'object') {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out.push(k);
			collectStrings(v, out, depth + 1);
		}
	}
}

function parseNumbersFromText(text: string): Pick<ContextOverflowInfo, 'nPromptTokens' | 'nCtx'> {
	const fromRequest = REQUEST_EXCEEDS_RE.exec(text);
	if (fromRequest) {
		return {
			nPromptTokens: Number(fromRequest[1]),
			nCtx: Number(fromRequest[2]),
		};
	}

	const nPrompt = N_PROMPT_RE.exec(text);
	const nCtx = N_CTX_RE.exec(text);
	return {
		nPromptTokens: nPrompt ? Number(nPrompt[1]) : undefined,
		nCtx: nCtx ? Number(nCtx[1]) : undefined,
	};
}

function looksLikeOverflow(text: string): boolean {
	return OVERFLOW_TYPE_RE.test(text) || REQUEST_EXCEEDS_RE.test(text);
}

// Разобрать 400 exceed_context_size (в т.ч. вложенный engine JSON)
export function parseContextOverflow(err: unknown): ContextOverflowInfo | undefined {
	const raw = err instanceof Error ? err.message : String(err ?? '');
	if (!raw.trim()) {
		return undefined;
	}

	// Только HTTP 400 (или текст без статуса, но с маркером overflow)
	if (err instanceof LlmHttpError && err.status !== 400) {
		return undefined;
	}

	const blobs: string[] = [raw];
	try {
		const start = raw.indexOf('{');
		if (start >= 0) {
			collectStrings(JSON.parse(raw.slice(start)) as unknown, blobs, 0);
		}
	} catch {}

	const joined = blobs.join('\n');
	if (!looksLikeOverflow(joined) && !looksLikeOverflow(raw)) {
		return undefined;
	}

	const nums = parseNumbersFromText(joined) ?? parseNumbersFromText(raw);
	const human = REQUEST_EXCEEDS_RE.exec(joined)?.[0]
		?? blobs.find((b) => /exceed|context size|n_ctx/i.test(b) && b.length < 500)
		?? raw.slice(0, 400);

	return {
		nPromptTokens: nums.nPromptTokens,
		nCtx: nums.nCtx,
		message: human.trim(),
		raw,
	};
}

export function isContextOverflowError(err: unknown): boolean {
	return parseContextOverflow(err) !== undefined;
}

export function formatContextOverflowUserMessage(
	info: ContextOverflowInfo,
	budget: number,
): string {
	const prompt = info.nPromptTokens ?? '?';
	const ctx = info.nCtx ?? '?';
	return vscode.l10n.t('chat.contextOverflow.userMessage', prompt, ctx, budget);
}

export class ContextBudgetExceededError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ContextBudgetExceededError';
	}
}
