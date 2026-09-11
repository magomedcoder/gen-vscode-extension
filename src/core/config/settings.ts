import { normalizeApprovalPolicy } from '../../features/agent/permissionPolicy';
import type { ApprovalPolicy } from './approvalTypes';
import * as vscode from 'vscode';
import type { ExtensionContext, Memento } from 'vscode';
import { initApiKeyStore } from './apiKey';
import { initMcpOAuthStore } from '../stores/mcpOAuthStore';
import { applyAdminPolicy, stripAdminLockedForStorage } from './adminPolicy';
import { deepMerge, getFileSettingsOverlay, initConfigLayers, onConfigLayersChanged, pickNonDefaultSettings } from './layers';
import { clearCachedNCtx } from '../llm/contextBudget';
import { DEFAULT_SETTINGS } from './types';
import type { ChatMode, ChatTextSize, ChatViewLocation, GenSettings, ProviderUsePolicy, RevealOnEdit, ShareMode, ThinkingDisplay, WebSearchBackend } from './types';
export type { ChatMode, ChatTextSize, ChatViewLocation, CommentStyle, GenSettings, ProviderUsePolicy, RevealOnEdit, ShareMode, ThinkingDisplay, WebSearchBackend } from './types';
export { DEFAULT_SETTINGS, EXAMPLE_DENIED_COMMANDS, EXAMPLE_DENIED_PATHS, EXAMPLE_SECRET_PATTERNS, DEFAULT_SENSITIVE_PATH_PATTERNS, isAgentLikeMode, resolveModeModel, resolveSmallModel } from './types';
export { getApiKey, hasApiKey, initApiKeyStore, setApiKey } from './apiKey';
export { FILE_LAYER_KEYS, getConfigLayersSnapshot, getEffectiveHooksInline, getEffectiveHooksPath, reloadConfigLayers } from './layers';
export { ADMIN_POLICY_KEYS, getAdminPolicySnapshot, isAdminPolicyActive } from './adminPolicy';
export type { AdminPolicyKey, AdminPolicySnapshot } from './adminPolicy';
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

function normalizeChatMode(raw: unknown): ChatMode {
	const mode = String(raw ?? '');
	if (mode === 'agent' || mode === 'debug' || mode === 'design' || mode === 'plan' || mode === 'multitask' || mode === 'project') {
		return mode;
	}

	return 'ask';
}

function normalizeChatTextSize(raw: unknown): ChatTextSize {
	const size = String(raw ?? '');
	if (size === 'compact' || size === 'large') {
		return size;
	}

	return 'default';
}

function normalizeThinkingDisplay(raw: unknown): ThinkingDisplay {
	const value = String(raw ?? '');
	if (value === 'off' || value === 'expanded') {
		return value;
	}

	return 'collapsed';
}

function normalizeRevealOnEdit(raw: unknown): RevealOnEdit {
	const value = String(raw ?? '');
	if (value === 'preview' || value === 'focus') {
		return value;
	}

	return 'never';
}

function normalizeShareMode(raw: Partial<GenSettings>): ShareMode {
	const mode = String(raw.shareMode ?? '');
	if (mode === 'manual' || mode === 'auto' || mode === 'disabled') {
		return mode;
	}

	return DEFAULT_SETTINGS.shareMode;
}

function normalizeChatViewLocation(raw: unknown): ChatViewLocation {
	const value = String(raw ?? '');
	if (value === 'panel' || value === 'sidebar' || value === 'both') {
		return value;
	}

	return 'both';
}

function normalizeWebSearchBackend(raw: unknown): WebSearchBackend {
	if (raw === 'http' || raw === 'exa' || raw === 'parallel') {
		return raw;
	}

	return 'duckduckgo';
}

function normalizeLocalEmbeddingsMode(raw: unknown): GenSettings['localEmbeddingsMode'] {
	const v = String(raw ?? '').trim().toLowerCase();
	if (v === 'off') {
		return 'off';
	}

	return 'trigram';
}

function normalizeProviderUsePolicy(raw: unknown): ProviderUsePolicy {
	return raw === 'deny' ? 'deny' : 'allow';
}

function normalize(raw: Partial<GenSettings>): GenSettings {
	const commentStyle = raw.commentStyle === 'block' ? 'block' : 'inline';
	const chatMode = normalizeChatMode(raw.chatMode);
	const shareMode = normalizeShareMode(raw);
	const baseUrl = String(raw.baseUrl ?? '').trim();
	const authHeader = String(raw.authHeader ?? DEFAULT_SETTINGS.authHeader).trim() || DEFAULT_SETTINGS.authHeader;
	const authScheme = String(raw.authScheme ?? DEFAULT_SETTINGS.authScheme).trim();
	const defaultToolTimeoutMs = Math.max(1000, Math.floor(asNumber(raw.defaultToolTimeoutMs, DEFAULT_SETTINGS.defaultToolTimeoutMs)));
	const maxToolTimeoutMs = Math.max(
		defaultToolTimeoutMs,
		Math.max(1000, Math.floor(asNumber(raw.maxToolTimeoutMs, DEFAULT_SETTINGS.maxToolTimeoutMs))),
	);

	return {
		baseUrl,
		model: String(raw.model ?? '').trim(),
		smallModel: String(raw.smallModel ?? '').trim(),
		planModel: String(raw.planModel ?? '').trim(),
		actModel: String(raw.actModel ?? '').trim(),
		chatMode,
		agentMaxIterations: clamp(Math.floor(asNumber(raw.agentMaxIterations, DEFAULT_SETTINGS.agentMaxIterations)), 0, 40),
		approvalPolicy: normalizeApprovalPolicy(raw.approvalPolicy),
		autoApprove: raw.autoApprove === true,
		continueLoopOnDeny: raw.continueLoopOnDeny !== false,
		enableWorkspaceContext: raw.enableWorkspaceContext !== false,
		alwaysOnWorkspaceContext: raw.alwaysOnWorkspaceContext === true,
		shareMode,
		primaryTools: normalizeStringList(raw.primaryTools),
		modelRoutedPatch: raw.modelRoutedPatch !== false,
		usernameDisplay: String(raw.usernameDisplay ?? '').trim(),
		watcherIgnore: normalizeStringList(raw.watcherIgnore),
		revealOnEdit: normalizeRevealOnEdit(raw.revealOnEdit),
		backgroundEditMode: raw.backgroundEditMode !== false,
		notifyOnComplete: raw.notifyOnComplete === true,
		notifySoundOnComplete: raw.notifySoundOnComplete === true,
		enableFileReading: raw.enableFileReading !== false,
		enableTerminal: raw.enableTerminal !== false,
		webSearchEnabled: raw.webSearchEnabled !== false,
		webSearchBackend: normalizeWebSearchBackend(raw.webSearchBackend),
		webSearchHttpUrl: String(raw.webSearchHttpUrl ?? DEFAULT_SETTINGS.webSearchHttpUrl).trim(),
		webSearchHttpHeader: String(raw.webSearchHttpHeader ?? DEFAULT_SETTINGS.webSearchHttpHeader).trim() || DEFAULT_SETTINGS.webSearchHttpHeader,
		// MVP: ключ в settings (interpolate); не для production - предпочтительнее SecretStorage
		webSearchApiKey: String(raw.webSearchApiKey ?? DEFAULT_SETTINGS.webSearchApiKey),
		webFetchEnabled: raw.webFetchEnabled !== false,
		systemPrompt: String(raw.systemPrompt ?? '').trim(),
		temperature: clamp(asNumber(raw.temperature, DEFAULT_SETTINGS.temperature), 0, 2),
		maxTokens: Math.max(64, Math.floor(asNumber(raw.maxTokens, DEFAULT_SETTINGS.maxTokens))),
		maxContextTokens: Math.max(1024, Math.floor(asNumber(raw.maxContextTokens, DEFAULT_SETTINGS.maxContextTokens))),
		contextOverflowPolicy: raw.contextOverflowPolicy === 'ask' || raw.contextOverflowPolicy === 'fail_fast'
			? raw.contextOverflowPolicy
			: 'auto_compact_retry',
		requestTimeoutMs: Math.max(1000, Math.floor(asNumber(raw.requestTimeoutMs, DEFAULT_SETTINGS.requestTimeoutMs))),
		defaultToolTimeoutMs,
		maxToolTimeoutMs,
		maxInputChars: Math.max(500, Math.floor(asNumber(raw.maxInputChars, DEFAULT_SETTINGS.maxInputChars))),
		commentStyle,
		previewBeforeApply: Boolean(raw.previewBeforeApply ?? DEFAULT_SETTINGS.previewBeforeApply),
		commentSystemPrompt: String(raw.commentSystemPrompt ?? DEFAULT_SETTINGS.commentSystemPrompt).trim(),
		deniedPaths: normalizeStringList(raw.deniedPaths),
		sensitivePathPatterns: 'sensitivePathPatterns' in raw
			? normalizeStringList(raw.sensitivePathPatterns)
			: [...DEFAULT_SETTINGS.sensitivePathPatterns],
		allowExternalDirectory: raw.allowExternalDirectory === true,
		deniedCommands: 'deniedCommands' in raw
			? normalizeStringList(raw.deniedCommands).map((item) => item.toLowerCase())
			: [...DEFAULT_SETTINGS.deniedCommands],
		secretPatterns: normalizeStringList(raw.secretPatterns),
		providerUsePolicy: normalizeProviderUsePolicy(raw.providerUsePolicy),
		providerUsePatterns: normalizeStringList(raw.providerUsePatterns),
		authHeader,
		authScheme,
		planWriteToFile: raw.planWriteToFile !== false,
		planShellPolicy: raw.planShellPolicy === 'deny' ? 'deny' : 'ask',
		snapshotEnabled: raw.snapshotEnabled !== false,
		loggingEnabled: raw.loggingEnabled === true,
		otelEnabled: raw.otelEnabled === true,
		otelEndpoint: String(raw.otelEndpoint ?? '').trim(),
		toolOutputMaxChars: Math.max(1000, Math.floor(asNumber(raw.toolOutputMaxChars, DEFAULT_SETTINGS.toolOutputMaxChars))),
		toolOutputModelMaxChars: Math.max(400, Math.floor(asNumber(raw.toolOutputModelMaxChars, DEFAULT_SETTINGS.toolOutputModelMaxChars))),
		codeModeEnabled: raw.codeModeEnabled === true,
		mcpServers: Array.isArray(raw.mcpServers)
			? raw.mcpServers.filter((s): s is NonNullable<typeof s> => Boolean(s && typeof s === 'object'))
				.map((s) => {
					const row = s as {
						name?: string;
						command?: string;
						args?: unknown;
						env?: Record<string, string>;
						headers?: Record<string, string>;
						cwd?: string;
						timeoutMs?: number;
						enabled?: boolean;
						oauth?: boolean;
						mcpOAuthIssuer?: string;
						mcpOAuthClientId?: string;
						mcpOAuthAuthorizeUrl?: string;
						mcpOAuthTokenUrl?: string;
					};
					const timeoutRaw = row.timeoutMs;
					const timeoutMs = typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw)
						? Math.max(1000, Math.floor(timeoutRaw))
						: undefined;
					const cwd = typeof row.cwd === 'string' && row.cwd.trim() ? row.cwd.trim() : undefined;
					// headers: только строковые пары ключ*значение
					let headers: Record<string, string> | undefined;
					if (row.headers && typeof row.headers === 'object' && !Array.isArray(row.headers)) {
						headers = {};
						for (const [k, v] of Object.entries(row.headers)) {
							if (typeof k === 'string' && typeof v === 'string') {
								headers[k] = v;
							}
						}

						if (Object.keys(headers).length === 0) {
							headers = undefined;
						}
					}

					// oauth: только true сохраняем; false / omit - по умолчанию выкл
					const oauth = row.oauth === true ? true : undefined;
					const issuer = typeof row.mcpOAuthIssuer === 'string' && row.mcpOAuthIssuer.trim()
						? row.mcpOAuthIssuer.trim()
						: undefined;
					const clientId = typeof row.mcpOAuthClientId === 'string' && row.mcpOAuthClientId.trim()
						? row.mcpOAuthClientId.trim()
						: undefined;
					const authorizeUrl = typeof row.mcpOAuthAuthorizeUrl === 'string' && row.mcpOAuthAuthorizeUrl.trim()
						? row.mcpOAuthAuthorizeUrl.trim()
						: undefined;
					const tokenUrl = typeof row.mcpOAuthTokenUrl === 'string' && row.mcpOAuthTokenUrl.trim()
						? row.mcpOAuthTokenUrl.trim()
						: undefined;
					return {
						name: String(row.name ?? '').trim(),
						transport: 'stdio' as const,
						command: String(row.command ?? '').trim(),
						args: Array.isArray(row.args) ? row.args.map(String) : undefined,
						env: row.env,
						headers,
						cwd,
						timeoutMs,
						enabled: row.enabled !== false,
						...(oauth ? { oauth } : {}),
						...(issuer ? { mcpOAuthIssuer: issuer } : {}),
						...(clientId ? { mcpOAuthClientId: clientId } : {}),
						...(authorizeUrl ? { 
							mcpOAuthAuthorizeUrl: authorizeUrl 
						} : {}),
						...(tokenUrl ? {
							mcpOAuthTokenUrl: tokenUrl
						} : {}),
					};
				}).filter((s) => s.name && s.command)
			: [],
		subagentDepth: clamp(Math.floor(asNumber(raw.subagentDepth, DEFAULT_SETTINGS.subagentDepth)), 1, 4),
		worktreesEnabled: raw.worktreesEnabled === true,
		worktreeStartCommand: String(raw.worktreeStartCommand ?? DEFAULT_SETTINGS.worktreeStartCommand).trim(),
		skillsPaths: normalizeStringList(raw.skillsPaths),
		skillsUrls: normalizeStringList(raw.skillsUrls),
		instructionUrls: normalizeStringList(raw.instructionUrls),
		personaId: String(raw.personaId ?? '').trim(),
		formatAfterEdit: raw.formatAfterEdit === true,
		gitSyncAutoKeep: raw.gitSyncAutoKeep === true,
		indexingEnabled: raw.indexingEnabled !== false,
		indexNewFolders: raw.indexNewFolders !== false,
		indexForGrep: raw.indexForGrep !== false,
		embeddingsBaseUrl: String(raw.embeddingsBaseUrl ?? '').trim(),
		embeddingsModel: String(raw.embeddingsModel ?? DEFAULT_SETTINGS.embeddingsModel).trim() || DEFAULT_SETTINGS.embeddingsModel,
		localEmbeddingsMode: normalizeLocalEmbeddingsMode(raw.localEmbeddingsMode),
		compactTailTurns: clamp(Math.floor(asNumber(raw.compactTailTurns, DEFAULT_SETTINGS.compactTailTurns)), 1, 40),
		compactPruneToolResults: raw.compactPruneToolResults !== false,
		compactReservedTokens: Math.max(0, Math.floor(asNumber(raw.compactReservedTokens, DEFAULT_SETTINGS.compactReservedTokens))),
		midLoopAutoCompact: raw.midLoopAutoCompact !== false,
		llmAutoCompact: raw.llmAutoCompact === true,
		visionEnabled: raw.visionEnabled === true,
		attachmentImageMaxBase64: Math.max(10_000, Math.floor(asNumber(raw.attachmentImageMaxBase64, DEFAULT_SETTINGS.attachmentImageMaxBase64))),
		attachmentImageMaxWidth: Math.max(64, Math.floor(asNumber(raw.attachmentImageMaxWidth, DEFAULT_SETTINGS.attachmentImageMaxWidth))),
		attachmentImageMaxHeight: Math.max(64, Math.floor(asNumber(raw.attachmentImageMaxHeight, DEFAULT_SETTINGS.attachmentImageMaxHeight))),
		attachmentImageAutoResize: raw.attachmentImageAutoResize !== false,
		chatTextSize: normalizeChatTextSize(raw.chatTextSize),
		thinkingDisplay: normalizeThinkingDisplay(raw.thinkingDisplay),
		chatViewLocation: normalizeChatViewLocation(raw.chatViewLocation),
		maxTabCount: clamp(Math.floor(asNumber(raw.maxTabCount, DEFAULT_SETTINGS.maxTabCount)), 1, 40),
		maxConcurrentRuns: clamp(Math.floor(asNumber(raw.maxConcurrentRuns, DEFAULT_SETTINGS.maxConcurrentRuns)), 1, 10),
	};
}

export function initSettings(context: ExtensionContext): void {
	store = context.globalState;
	initApiKeyStore(context);
	initMcpOAuthStore(context);
	sessionModel = '';
	// JSON-слои: user (~/.config/gen) + project (.gen/config.json)
	initConfigLayers(context);
	context.subscriptions.push(
		onConfigLayersChanged(() => {
			for (const listener of listeners) {
				listener();
			}
			void syncChatViewLocationToWorkspace(getSettings().chatViewLocation);
		}),
	);
	// when-clause для views читает contributes.configuration - синхронизируем с GenSettings
	void syncChatViewLocationToWorkspace(getSettings().chatViewLocation);
}

// Прописать gen.chatViewLocation в VS Code config (для view `when`)
async function syncChatViewLocationToWorkspace(location: ChatViewLocation): Promise<void> {
	const config = vscode.workspace.getConfiguration('gen');
	const current = config.get<string>('chatViewLocation');
	if (current === location) {
		return;
	}

	await config.update('chatViewLocation', location, vscode.ConfigurationTarget.Global);
}

export function setSessionModel(model: string): void {
	sessionModel = model.trim();
	for (const listener of listeners) {
		listener();
	}
}

/**
 * Эффективные GenSettings.
 *
 * Слои (низкий * высокий): defaults * user JSON * UI (non-default) * project JSON * admin policy.
 * Подробнее: docs/settings*.md и src/config/layers.ts / adminPolicy.ts.
 */
export function getSettings(): GenSettings {
	const stored = store?.get<Partial<GenSettings>>(STORAGE_KEY);
	const { user, project } = getFileSettingsOverlay();
	const uiOverlay = pickNonDefaultSettings(stored);
	// project перекрывает UI и user; admin - поверх всех для locked keys
	const merged = applyAdminPolicy(
		deepMerge({}, user, uiOverlay, project) as Partial<GenSettings>,
	);
	const settings = normalize({
		...merged,
		model: '',
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

	const prev = getSettings();
	sessionModel = String(next.model ?? '').trim();
	const normalized = stripAdminLockedForStorage(normalize({
		...next,
		model: ''
	}));
	await store.update(STORAGE_KEY, normalized);
	await syncChatViewLocationToWorkspace(getSettings().chatViewLocation);
	const effective = getSettings();
	if (prev.baseUrl !== effective.baseUrl || prev.model !== effective.model) {
		clearCachedNCtx();
	}
	
	for (const listener of listeners) {
		listener();
	}

	return effective;
}

export function onSettingsChanged(listener: () => void): { dispose(): void } {
	listeners.add(listener);
	return {
		dispose: () => {
			listeners.delete(listener);
		},
	};
}
