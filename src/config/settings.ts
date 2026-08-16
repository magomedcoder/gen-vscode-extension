import type { ExtensionContext, Memento } from 'vscode';
import { DEFAULT_SETTINGS, type GenSettings } from './types';

export type { ChatMode, CommentStyle, GenSettings } from './types';
export { DEFAULT_SETTINGS } from './types';

const STORAGE_KEY = 'gen.settings';

let store: Memento | undefined;

function asNumber(value: unknown, fallback: number): number {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normalize(raw: Partial<GenSettings>): GenSettings {
	const commentStyle = raw.commentStyle === 'block' ? 'block' : 'inline';
	const chatMode = raw.chatMode === 'agent' ? 'agent' : 'ask';

	return {
		baseUrl: String(raw.baseUrl ?? '').trim(),
		model: String(raw.model ?? '').trim(),
		chatMode,
		agentMaxIterations: clamp(Math.floor(asNumber(raw.agentMaxIterations, DEFAULT_SETTINGS.agentMaxIterations)), 1, 40),
		agentConfirmWrites: Boolean(raw.agentConfirmWrites ?? DEFAULT_SETTINGS.agentConfirmWrites),
		temperature: clamp(asNumber(raw.temperature, DEFAULT_SETTINGS.temperature), 0, 2),
		maxTokens: Math.max(64, Math.floor(asNumber(raw.maxTokens, DEFAULT_SETTINGS.maxTokens))),
		requestTimeoutMs: Math.max(1000, Math.floor(asNumber(raw.requestTimeoutMs, DEFAULT_SETTINGS.requestTimeoutMs))),
		maxInputChars: Math.max(500, Math.floor(asNumber(raw.maxInputChars, DEFAULT_SETTINGS.maxInputChars))),
		commentStyle,
		previewBeforeApply: Boolean(raw.previewBeforeApply ?? DEFAULT_SETTINGS.previewBeforeApply),
	};
}

export function initSettings(context: ExtensionContext): void {
	store = context.globalState;
}

export function getSettings(): GenSettings {
	const raw = store?.get<Partial<GenSettings>>(STORAGE_KEY, DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS;
	return normalize(raw);
}

export async function updateSettings(next: GenSettings): Promise<GenSettings> {
	if (!store) {
		throw new Error('Хранилище настроек не инициализировано');
	}

	const normalized = normalize(next);
	await store.update(STORAGE_KEY, normalized);
	return normalized;
}
