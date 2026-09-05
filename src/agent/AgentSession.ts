import * as vscode from 'vscode';
import { getSettings } from '../config/settings';
import type { ChatMode } from '../config/types';
import type { ChatMessage, LlmClient, LlmRetryInfo, LlmToolCall } from '../llm/types';
import type { ChatUiMessage, ToolCallStatus, ToolCallUi } from '../chat/protocol';
import { pathFromToolArguments } from './diff';
import { AgentCheckpoint } from './checkpoint';
import { clearIgnoreCache } from './gitIgnore';
import { formatStickyPlanForPrompt, StickyPlan } from './plan';
import { buildAgentSystemPrompt } from './prompts';
import { getGenRulesManager } from '../project/genrules';
import { loadProjectRulesAppendix } from '../project/projectRules';
import { discoverSkills, formatSkillsCatalog } from '../project/skills';
import { formatPersonaAppendix, resolvePersona } from '../project/personas';
import { recordUsage } from '../stores/usageStore';
import { redactSecrets } from './secrets';
import { executeAgentTool, getAgentLlmTools } from './tools';
import type { ExtendedToolContext } from './tools';
import { TodoStore } from './todoStore';
import { isMutatingTool } from './auth';
import { resolveSubagent } from './subagents';
import { defaultWorkspaceCwd, ShellSession } from './shellSession';
import { sanitizeToolArgumentsForApi, type ToolContext } from './types';
import type { AgentWriteTracker } from './userEdits';
import { confirmOrSkip } from './tools/confirm';
import { buildUserContentWithImages, type ImageAttachment } from '../chat/attachments';

function messageId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === 'AbortError';
}

function toAbortError(): Error {
	const err = new Error(vscode.l10n.t('agent.operationCancelled'));
	err.name = 'AbortError';
	return err;
}

function truncate(text: string, max = 4000): string {
	if (text.length <= max) {
		return text;
	}

	return `${text.slice(0, max)}\n${vscode.l10n.t('agent.truncatedChars', text.length - max)}`;
}

// Отпечаток tool+args для doom loop (похожие вызовы, не полный JSON)
function doomArgsFingerprint(name: string, rawArgs: string): string {
	try {
		const args = JSON.parse(rawArgs) as Record<string, unknown>;
		const keys = ['path', 'command', 'url', 'query', 'old_string', 'pattern', 'cwd', 'job_id', 'subagent_type', 'file'];
		const parts: string[] = [];
		for (const key of keys) {
			if (!(key in args)) {
				continue;
			}

			const value = args[key];
			const text = typeof value === 'string' ? value.slice(0, 160) : JSON.stringify(value)?.slice(0, 160) ?? '';
			parts.push(`${key}=${text}`);
		}

		if (parts.length === 0) {
			return `${name}\n${rawArgs.trim().slice(0, 240)}`;
		}

		return `${name}\n${parts.join('|')}`;
	} catch {
		return `${name}\n${rawArgs.trim().slice(0, 240)}`;
	}
}

function normalizeAgentMode(mode: ChatMode | undefined): ChatMode {
	if (mode === 'debug' || mode === 'design' || mode === 'plan' || mode === 'multitask') {
		return mode;
	}

	return 'agent';
}

function isReadonlyMode(mode: ChatMode): boolean {
	return mode === 'plan' || mode === 'multitask';
}

function historyToApiMessages(history: ChatUiMessage[]): ChatMessage[] {
	const out: ChatMessage[] = [];

	for (const msg of history) {
		if (msg.role === 'user') {
			out.push({
				role: 'user',
				content: msg.content
			});
			continue;
		}

		if (msg.role === 'assistant') {
			if (!msg.content && !msg.toolCalls?.length) {
				continue;
			}

			const toolCalls = msg.toolCalls?.map((tc) => ({
				id: tc.id,
				type: 'function' as const,
				function: {
					name: tc.name,
					arguments: sanitizeToolArgumentsForApi(redactSecrets(tc.arguments).text),
				},
			}));
			out.push({
				role: 'assistant',
				content: msg.content || null,
				...(toolCalls?.length ? {
					tool_calls: toolCalls
				} : {}),
			});
			continue;
		}

		if (msg.role === 'tool' && msg.toolCallId) {
			out.push({
				role: 'tool',
				tool_call_id: msg.toolCallId,
				content: redactSecrets(msg.content).text,
				name: msg.toolName,
			});
		}
	}

	return out;
}

function toToolCallUi(call: LlmToolCall, status: ToolCallStatus = 'pending'): ToolCallUi {
	return {
		id: call.id,
		name: call.function.name,
		arguments: call.function.arguments,
		path: pathFromToolArguments(call.function.arguments),
		status,
	};
}

export type AgentUiSink = {
	append(message: ChatUiMessage): void;

	update(id: string, patch: Partial<ChatUiMessage>): void;
};

export class AgentSession {
	constructor(private readonly client: LlmClient) {}

	async run(params: {
		history: ChatUiMessage[];
		userText: string;
		editorContext?: string;
		attachments?: readonly ImageAttachment[];
		signal: AbortSignal;
		ui: AgentUiSink;
		confirm?: ToolContext['confirm'];
		revealFile?: ToolContext['revealFile'];
		trackMutation?: ToolContext['trackMutation'];
		plan?: StickyPlan;
		onPlanChanged?: ToolContext['onPlanChanged'];
		checkpoint?: AgentCheckpoint;
		writes?: AgentWriteTracker;
		planEditsAppendix?: string;
		mode?: ChatMode;
		sessionAllow?: string[];
		onAlwaysAllow?: (pattern: string) => void;
		setChatMode?: (mode: ChatMode) => void | Promise<void>;
		// Колбэк перед паузой HTTP-retry (пробрасывается в LLM client)
		onRetry?: (info: LlmRetryInfo) => void;
		// Глубина вложенного субагента (0 = основной агент)
		subagentDepth?: number;
		// Принудительно только read-only tools (explore)
		readonlySubagent?: boolean;
		// Доп. system prompt для субагентов
		subagentSystem?: string;
		maxIterationsOverride?: number;
	}): Promise<void> {
		const settings = getSettings();
		const maxIterations = params.maxIterationsOverride
			?? settings.agentMaxIterations;
		const unlimited = !params.maxIterationsOverride && maxIterations === 0;
		let toolsEnabled = true;
		const plan = params.plan ?? new StickyPlan();
		const checkpoint = params.checkpoint ?? new AgentCheckpoint();
		const writes = params.writes;
		const todos = new TodoStore();
		const shell = new ShellSession(defaultWorkspaceCwd());
		const depth = params.subagentDepth ?? 0;
		let agentMode: ChatMode = normalizeAgentMode(params.mode);
		clearIgnoreCache();

		const userText = params.editorContext
			? `${params.userText}\n\n---\nКонтекст:\n${params.editorContext}`
			: params.userText;
		const userContent = await buildUserContentWithImages(userText, params.attachments);

		const userEditsAppendix = writes ? await writes.buildPromptAppendix() : '';
		const planSnap = plan.snapshot();
		const planAppendix = planSnap?.approved ? formatStickyPlanForPrompt(planSnap) : '';
		const planEditsAppendix = params.planEditsAppendix?.trim() ?? '';
		const genRulesAppendix =
			(await loadProjectRulesAppendix())
			?? getGenRulesManager()?.getPromptAppendix()
			?? '';
		const skillsAppendix = depth === 0 ? (formatSkillsCatalog(await discoverSkills()) ?? '') : '';
		let personaAppendix = '';
		if (depth === 0 && settings.personaId.trim()) {
			const persona = await resolvePersona(settings.personaId);
			if (persona) {
				personaAppendix = formatPersonaAppendix(persona);
			}
		}
		const customSystem = [
			settings.systemPrompt.trim(),
			personaAppendix,
			params.subagentSystem?.trim() ?? '',
		].filter(Boolean).join('\n\n');

		const buildSystem = (toolsAvailable: boolean, mode: ChatMode) => [
			customSystem,
			buildAgentSystemPrompt({
				toolsAvailable,
				authLevel: settings.agentAuthLevel,
				deniedPaths: settings.deniedPaths,
				userEditsAppendix,
				planAppendix,
				planEditsAppendix,
				genRulesAppendix,
				skillsAppendix,
				planWriteToFile: settings.planWriteToFile,
				mode,
			}),
		].filter(Boolean).join('\n\n');

		const apiMessages: ChatMessage[] = [
			{
				role: 'system',
				content: buildSystem(true, agentMode),
			},
			...historyToApiMessages(params.history),
			{
				role: 'user',
				content: userContent,
			},
		];

		const toolCtxBase: ExtendedToolContext = {
			signal: params.signal,
			confirm: params.confirm,
			revealFile: params.revealFile,
			trackMutation: params.trackMutation,
			plan,
			onPlanChanged: params.onPlanChanged,
			checkpoint,
			writes,
			todos,
			shell,
			sessionAllow: params.sessionAllow,
			onAlwaysAllow: params.onAlwaysAllow,
			subagentDepth: depth,
			setChatMode: async (mode) => {
				await params.setChatMode?.(mode);
				if (mode === 'ask') {
					toolsEnabled = false;
					agentMode = 'agent';
				} else {
					agentMode = normalizeAgentMode(mode);
				}
				// Обновить system prompt под новый режим
				apiMessages[0] = {
					role: 'system',
					content: buildSystem(toolsEnabled, agentMode),
				};
			},
			runSubagent: async ({ type, prompt, signal }) => {
				const def = await resolveSubagent(type);
				const child = new AgentSession(this.client);
				const chunks: string[] = [];
				await child.run({
					history: [],
					userText: prompt,
					signal,
					confirm: params.confirm,
					revealFile: params.revealFile,
					trackMutation: params.trackMutation,
					// permission.task: субагент не наследует sessionAllow родителя (строже)
					sessionAllow: undefined,
					onAlwaysAllow: params.onAlwaysAllow,
					subagentDepth: depth + 1,
					readonlySubagent: def?.readonly ?? true,
					subagentSystem: def?.prompt,
					maxIterationsOverride: def?.maxIterations ?? 12,
					mode: 'agent',
					onRetry: params.onRetry,
					ui: {
						append: (message) => {
							if (message.role === 'assistant' && message.content.trim()) {
								chunks.push(message.content.trim());
							}

							if (message.role === 'error') {
								chunks.push(`[error] ${message.content}`);
							}

							params.ui.append({
								...message,
								content: message.role === 'assistant'
									? `[subagent:${type}] ${message.content}`
									: message.content,
							});
						},
						update: (id, patch) => params.ui.update(id, patch),
					},
				});
				return chunks.slice(-3).join('\n\n') || '(subagent finished with no text)';
			},
		};

		// Doom loop: одинаковый tool+args падает 3 раза подряд -> confirm на следующий вызов
		let doomKey = '';
		let doomFails = 0;

		for (let iteration = 0; unlimited || iteration < maxIterations; iteration += 1) {
			if (params.signal.aborted) {
				throw toAbortError();
			}

			const toolOpts = {
				readonly: params.readonlySubagent === true || isReadonlyMode(agentMode),
				disableTask: depth > 0,
			};

			const assistantId = messageId();
			let streamed = '';
			params.ui.append({
				id: assistantId,
				role: 'assistant',
				content: '',
			});

			const result = await this.client.complete({
				messages: apiMessages,
				signal: params.signal,
				tools: toolsEnabled ? getAgentLlmTools(agentMode, toolOpts) : undefined,
				toolChoice: toolsEnabled ? 'auto' : 'none',
				onDelta: (chunk) => {
					streamed += chunk;
					params.ui.update(assistantId, {
						content: streamed
					});
				},
				onRetry: params.onRetry,
			});

			if (result.toolsFallback && toolsEnabled) {
				toolsEnabled = false;
				apiMessages[0] = {
					role: 'system',
					content: buildSystem(false, agentMode),
				};
				params.ui.append({
					id: messageId(),
					role: 'error',
					content: vscode.l10n.t('agent.toolsUnsupported'),
				});
			}

			const toolCalls = result.toolCalls ?? [];
			const content = (result.content || streamed).trim();
			params.ui.update(assistantId, {
				content,
				usage: result.usage,
			});
			if (result.usage) {
				recordUsage(
					settings.model,
					result.usage.promptTokens ?? 0,
					result.usage.completionTokens ?? 0,
				);
			}

			if (toolCalls.length === 0) {
				if (!content) {
					params.ui.update(assistantId, {
						content: vscode.l10n.t('agent.emptyModelReply'),
					});
				}
				return;
			}

			const orderedCalls = [...toolCalls].sort((a, b) => {
				if (a.function.name === 'propose_plan' && b.function.name !== 'propose_plan') {
					return -1;
				}

				if (b.function.name === 'propose_plan' && a.function.name !== 'propose_plan') {
					return 1;
				}

				return 0;
			});

			const liveCalls = orderedCalls.map((c) => toToolCallUi(c, 'pending'));
			params.ui.update(assistantId, {
				content: content || '',
				toolCalls: liveCalls.map((c) => ({ ...c })),
			});

			apiMessages.push({
				role: 'assistant',
				content: content || null,
				tool_calls: orderedCalls.map((call) => ({
					...call,
					function: {
						...call.function,
						arguments: sanitizeToolArgumentsForApi(call.function.arguments),
					},
				})),
			});

			const runOne = async (i: number) => {
				if (params.signal.aborted) {
					throw toAbortError();
				}
				const call = orderedCalls[i]!;
				const failKey = doomArgsFingerprint(call.function.name, call.function.arguments);

				// После 3 одинаковых провалов - принудительный confirm + сброс skipConfirm
				if (doomKey === failKey && doomFails >= 3) {
					toolCtxBase.skipConfirm = false;
					const denied = await confirmOrSkip(
						toolCtxBase,
						'Doom loop: повтор падающего tool',
						`Инструмент «${call.function.name}» уже трижды завершился ошибкой с похожими аргументами. Продолжить ещё раз или сменить подход?`,
					);
					if (denied) {
						const resultText = truncate(denied.content + '\n\n[doom_loop] Смени аргументы или другой tool - тот же вызов уже падал 3 раза.');
						liveCalls[i] = {
							...liveCalls[i]!,
							status: 'denied',
							result: resultText,
						};
						params.ui.update(assistantId, {
							toolCalls: liveCalls.map((c) => ({ ...c })),
						});
						params.ui.append({
							id: messageId(),
							role: 'tool',
							content: resultText,
							toolCallId: call.id,
							toolName: call.function.name,
							toolArgs: call.function.arguments,
							toolStatus: 'denied',
						});
						return {
							role: 'tool' as const,
							tool_call_id: call.id,
							name: call.function.name,
							content: redactSecrets(resultText).text,
							denied: true,
						};
					}
				}

				const toolResult = await executeAgentTool(call.function.name, call.function.arguments, toolCtxBase);
				const lengthHint = !toolResult.ok && result.finishReason === 'length'
					? vscode.l10n.t('agent.responseTruncated')
					: '';
				let resultText = truncate(`${toolResult.content}${lengthHint}`);

				if (!toolResult.ok && !toolResult.denied) {
					if (doomKey === failKey) {
						doomFails += 1;
					} else {
						doomKey = failKey;
						doomFails = 1;
					}

					if (doomFails >= 3) {
						toolCtxBase.skipConfirm = false;
						resultText = truncate(`${resultText}\n\n[doom_loop] Тот же tool+похожие args упал ${doomFails} раз подряд. Не повторяй без изменений - смени подход или попроси подтверждение.`);
					}
				} else if (toolResult.ok) {
					doomKey = '';
					doomFails = 0;
				}

				const status: ToolCallStatus = toolResult.denied ? 'denied' : toolResult.ok ? 'ok' : 'error';

				liveCalls[i] = {
					...liveCalls[i]!,
					status,
					result: resultText,
					path: toolResult.path ?? liveCalls[i]!.path,
					diff: toolResult.diff,
					hunks: toolResult.hunks,
				};
				params.ui.update(assistantId, {
					toolCalls: liveCalls.map((c) => ({ ...c })),
				});

				params.ui.append({
					id: messageId(),
					role: 'tool',
					content: resultText,
					toolCallId: call.id,
					toolName: call.function.name,
					toolArgs: call.function.arguments,
					toolStatus: status,
				});

				return {
					role: 'tool' as const,
					tool_call_id: call.id,
					name: call.function.name,
					content: redactSecrets(resultText).text,
					denied: Boolean(toolResult.denied),
				};
			};

			// Tools только на чтение - параллельно; мутирующие - строго по очереди.
			const toolApiMessages: ChatMessage[] = [];
			let i = 0;
			while (i < orderedCalls.length) {
				if (params.signal.aborted) {
					throw toAbortError();
				}

				const call = orderedCalls[i]!;
				if (isMutatingTool(call.function.name) || call.function.name === 'propose_plan' || call.function.name === 'ask_question') {
					const msg = await runOne(i);
					if (msg.denied && !settings.continueLoopOnDeny) {
						apiMessages.push({
							role: 'tool',
							tool_call_id: msg.tool_call_id,
							name: msg.name,
							content: msg.content
						});
						return;
					}
					toolApiMessages.push({
						role: 'tool',
						tool_call_id: msg.tool_call_id,
						name: msg.name,
						content: msg.content
					});
					i += 1;
					continue;
				}

				let j = i;
				while (j < orderedCalls.length && !isMutatingTool(orderedCalls[j]!.function.name) && orderedCalls[j]!.function.name !== 'propose_plan' && orderedCalls[j]!.function.name !== 'ask_question') {
					j += 1;
				}

				const batch = await Promise.all(Array.from({ length: j - i }, (_, k) => runOne(i + k)));

				for (const msg of batch) {
					toolApiMessages.push({
						role: 'tool',
						tool_call_id: msg.tool_call_id,
						name: msg.name,
						content: msg.content
					});
					if (msg.denied && !settings.continueLoopOnDeny) {
						apiMessages.push(...toolApiMessages);
						return;
					}
				}
				i = j;
			}
			apiMessages.push(...toolApiMessages);
		}

		if (unlimited) {
			return;
		}

		params.ui.append({
			id: messageId(),
			role: 'error',
			content: vscode.l10n.t('agent.iterationLimit', maxIterations),
		});
	}
}
