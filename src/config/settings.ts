import { normalizeApprovalPolicy } from '../agent/permissionPolicy';
import * as vscode from 'vscode';
import type { ExtensionContext, Memento } from 'vscode';
import { initApiKeyStore } from './apiKey';
import { DEFAULT_SETTINGS } from './types';
import type { AgentAuthLevel, ChatMode, GenSettings } from './types';
export type { AgentAuthLevel, ChatMode, CommentStyle, GenSettings } from './types';
export { DEFAULT_SETTINGS, EXAMPLE_DENIED_COMMANDS, EXAMPLE_DENIED_PATHS, EXAMPLE_SECRET_PATTERNS, isAgentLikeMode } from './types';
export { getApiKey, hasApiKey, initApiKeyStore, setApiKey } from './apiKey';

const STORAGE_KEY = 'gen.settings';

let store: Memento | undefined;
let sessionModel = '';
const listeners = new Set<() => void>();

function asNumber(value: unknown, fallback: number): number {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

const MAX_LIST_ITEMS = 80;
const MAX_LIST_ITEM_LEN = 400;

function normalizeStringList(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
	const out: string[] = [];
	
	for (const item of raw) {
		const line = String(item).trim();
		if (!line) {
			continue;
		}

		out.push(line.slice(0, MAX_LIST_ITEM_LEN));
		if (out.length >= MAX_LIST_ITEMS) {
			break;
		}
	}

	return out;
}

function normalizeAuthLevel(raw: Partial<GenSettings> & { agentConfirmWrites?: boolean }): AgentAuthLevel {
	const level = String(raw.agentAuthLevel ?? '');
	if (level === 'open') {
		return 'open';
	}

	if (level === 'auto' || level === 'ask') {
		return level;
	}

	if (raw.agentConfirmWrites === false) {
		return 'open';
	}
	
	return 'ask';
}

function normalizeChatMode(raw: unknown): ChatMode {
	const mode = String(raw ?? '');
	if (mode === 'agent' || mode === 'debug' || mode === 'design' || mode === 'plan') {
		return mode;
	}

	return 'ask';
}

function normalize(raw: Partial<GenSettings> & { agentConfirmWrites?: boolean }): GenSettings {
	const commentStyle = raw.commentStyle === 'block' ? 'block' : 'inline';
	const chatMode = normalizeChatMode(raw.chatMode);

	return {
		baseUrl: String(raw.baseUrl ?? '').trim(),
		model: String(raw.model ?? '').trim(),
		smallModel: String(raw.smallModel ?? '').trim(),
		chatMode,
		agentMaxIterations: clamp(Math.floor(asNumber(raw.agentMaxIterations, DEFAULT_SETTINGS.agentMaxIterations)), 0, 40),
		agentAuthLevel: normalizeAuthLevel(raw),
		approvalPolicy: normalizeApprovalPolicy(raw.approvalPolicy),
		autoApprove: raw.autoApprove === true,
		continueLoopOnDeny: raw.continueLoopOnDeny !== false,
		enableWorkspaceContext: raw.enableWorkspaceContext !== false,
		enableFileReading: raw.enableFileReading !== false,
		enableTerminal: raw.enableTerminal !== false,
		webSearchEnabled: raw.webSearchEnabled !== false,
		webFetchEnabled: raw.webFetchEnabled !== false,
		systemPrompt: String(raw.systemPrompt ?? '').trim(),
		temperature: clamp(asNumber(raw.temperature, DEFAULT_SETTINGS.temperature), 0, 2),
		maxTokens: Math.max(64, Math.floor(asNumber(raw.maxTokens, DEFAULT_SETTINGS.maxTokens))),
		requestTimeoutMs: Math.max(1000, Math.floor(asNumber(raw.requestTimeoutMs, DEFAULT_SETTINGS.requestTimeoutMs))),
		maxInputChars: Math.max(500, Math.floor(asNumber(raw.maxInputChars, DEFAULT_SETTINGS.maxInputChars))),
		commentStyle,
		previewBeforeApply: Boolean(raw.previewBeforeApply ?? DEFAULT_SETTINGS.previewBeforeApply),
		commentSystemPrompt: String(raw.commentSystemPrompt ?? DEFAULT_SETTINGS.commentSystemPrompt).trim(),
		deniedPaths: normalizeStringList(raw.deniedPaths),
		deniedCommands: 'deniedCommands' in raw
			? normalizeStringList(raw.deniedCommands).map((item) => item.toLowerCase())
			: [...DEFAULT_SETTINGS.deniedCommands],
		secretPatterns: normalizeStringList(raw.secretPatterns),
		authHeader: String(raw.authHeader ?? DEFAULT_SETTINGS.authHeader).trim() || DEFAULT_SETTINGS.authHeader,
		authScheme: String(raw.authScheme ?? DEFAULT_SETTINGS.authScheme).trim(),
		planWriteToFile: raw.planWriteToFile !== false,
		loggingEnabled: raw.loggingEnabled === true,
		toolOutputMaxChars: Math.max(1000, Math.floor(asNumber(raw.toolOutputMaxChars, DEFAULT_SETTINGS.toolOutputMaxChars))),
		mcpServers: Array.isArray(raw.mcpServers)
			? raw.mcpServers
				.filter((s): s is NonNullable<typeof s> => Boolean(s && typeof s === 'object'))
				.map((s) => ({
					name: String((s as { name?: string }).name ?? '').trim(),
					transport: 'stdio' as const,
					command: String((s as { command?: string }).command ?? '').trim(),
					args: Array.isArray((s as { args?: unknown }).args)
						? ((s as { args: unknown[] }).args).map(String)
						: undefined,
					env: (s as { env?: Record<string, string> }).env,
					enabled: (s as { enabled?: boolean }).enabled !== false,
				})).filter((s) => s.name && s.command)
			: [],
		subagentDepth: clamp(Math.floor(asNumber(raw.subagentDepth, DEFAULT_SETTINGS.subagentDepth)), 1, 4),
	};
}

export function initSettings(context: ExtensionContext): void {
	store = context.globalState;
	initApiKeyStore(context);
	sessionModel = '';
	void migrateStripPersistedModel();
}

async function migrateStripPersistedModel(): Promise<void> {
	if (!store) {
		return;
	}

	const raw = store.get<Partial<GenSettings>>(STORAGE_KEY);
	if (!raw || !String(raw.model ?? '').trim()) {
		return;
	}

	await store.update(STORAGE_KEY, normalize({ 
		...raw,
		model: ''
	}));
}

export function setSessionModel(model: string): void {
	sessionModel = model.trim();
	for (const listener of listeners) {
		listener();
	}
}

export function getSettings(): GenSettings {
	const raw = store?.get<Partial<GenSettings>>(STORAGE_KEY, DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS;
	const settings = normalize({ 
		...raw, 
		model: ''
	});
	return {
		...settings,
		model: sessionModel,
	};
}

export async function updateSettings(next: GenSettings): Promise<GenSettings> {
	if (!store) {
		throw new Error(vscode.l10n.t('config.settingsNotInit'));
	}

	sessionModel = String(next.model ?? '').trim();
	const normalized = normalize({ ...next, model: '' });
	await store.update(STORAGE_KEY, normalized);
	for (const listener of listeners) {
		listener();
	}

	return getSettings();
}

export function onSettingsChanged(listener: () => void): { dispose(): void } {
	listeners.add(listener);
	return {
		dispose: () => {
			listeners.delete(listener);
		},
	};
}
