import * as vscode from 'vscode';
import { getSettings } from '../config/settings';
import type { ChatMessage, LlmClient, LlmToolCall } from '../llm/types';
import type { ChatUiMessage, ToolCallStatus, ToolCallUi } from '../chat/protocol';
import { pathFromToolArguments } from './diff';
import { AgentCheckpoint } from './checkpoint';
import { clearIgnoreCache } from './gitIgnore';
import { formatStickyPlanForPrompt, StickyPlan } from './plan';
import { buildAgentSystemPrompt } from './prompts';
import { redactSecrets } from './secrets';
import { executeAgentTool, getAgentLlmTools } from './tools';
import { sanitizeToolArgumentsForApi, type ToolContext } from './types';
import type { AgentWriteTracker } from './userEdits';

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
	}): Promise<void> {
		const settings = getSettings();
		const maxIterations = settings.agentMaxIterations;
		const unlimited = maxIterations === 0;
		let toolsEnabled = true;
		const plan = params.plan ?? new StickyPlan();
		const checkpoint = params.checkpoint ?? new AgentCheckpoint();
		const writes = params.writes;
		clearIgnoreCache();

		const userContent = params.editorContext
			? `${params.userText}\n\n---\nКонтекст:\n${params.editorContext}`
			: params.userText;

		const userEditsAppendix = writes ? await writes.buildPromptAppendix() : '';
		const planSnap = plan.snapshot();
		const planAppendix = planSnap?.approved ? formatStickyPlanForPrompt(planSnap) : '';
		const planEditsAppendix = params.planEditsAppendix?.trim() ?? '';
		const apiMessages: ChatMessage[] = [
			{
				role: 'system',
				content: buildAgentSystemPrompt({
					toolsAvailable: true,
					authLevel: settings.agentAuthLevel,
					deniedPaths: settings.deniedPaths,
					userEditsAppendix,
					planAppendix,
					planEditsAppendix,
				})
			},
			...historyToApiMessages(params.history),
			{
				role: 'user',
				content: userContent
			},
		];

		for (let iteration = 0; unlimited || iteration < maxIterations; iteration += 1) {
			if (params.signal.aborted) {
				throw toAbortError();
			}

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
				tools: toolsEnabled ? getAgentLlmTools() : undefined,
				toolChoice: toolsEnabled ? 'auto' : 'none',
				onDelta: (chunk) => {
					streamed += chunk;
					params.ui.update(assistantId, {
						content: streamed
					});
				},
			});

			if (result.toolsFallback && toolsEnabled) {
				toolsEnabled = false;
				apiMessages[0] = {
					role: 'system',
					content: buildAgentSystemPrompt({
						toolsAvailable: false,
						userEditsAppendix,
						planAppendix,
						planEditsAppendix,
					}),
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

			for (let i = 0; i < orderedCalls.length; i += 1) {
				if (params.signal.aborted) {
					throw toAbortError();
				}

				const call = orderedCalls[i];
				const toolResult = await executeAgentTool(call.function.name, call.function.arguments, {
					signal: params.signal,
					confirm: params.confirm,
					revealFile: params.revealFile,
					trackMutation: params.trackMutation,
					plan,
					onPlanChanged: params.onPlanChanged,
					checkpoint,
					writes,
				});
				const lengthHint = !toolResult.ok && result.finishReason === 'length'
					? vscode.l10n.t('agent.responseTruncated')
					: '';
				const resultText = truncate(`${toolResult.content}${lengthHint}`);
				const status: ToolCallStatus = toolResult.denied ? 'denied' : toolResult.ok ? 'ok' : 'error';

				liveCalls[i] = {
					...liveCalls[i],
					status,
					result: resultText,
					path: toolResult.path ?? liveCalls[i].path,
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

				apiMessages.push({
					role: 'tool',
					tool_call_id: call.id,
					name: call.function.name,
					content: redactSecrets(resultText).text,
				});
			}
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
