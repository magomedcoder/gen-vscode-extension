import * as vscode from 'vscode';
import type { LlmToolDefinition } from '../../llm/types';
import { getSettings } from '../../config/settings';
import { logAgentTool } from '../audit';
import { denyMutatingIfAuto, isMutatingTool } from '../auth';
import { evaluateApproval, toolActionType } from '../permissionPolicy';
import { mutationPathsFromArgs } from '../plan';
import { extractPathFromPartialJson, parseToolArguments, toLlmToolDefinition, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { applyPatchTool } from './applyPatch';
import { applyWorkspaceEditTool } from './applyWorkspaceEdit';
import { createDirTool } from './createDir';
import { deleteFileTool } from './deleteFile';
import { getActiveEditorTool, getOpenEditorsTool } from './editors';
import { getDiagnosticsTool } from './getDiagnostics';
import { getWorkspaceInfoTool } from './getWorkspaceInfo';
import { gitStatusTool } from './gitStatus';
import { listDirTool } from './listDir';
import { closeFileTool, openFileTool, revealLineTool } from './navigation';
import { proposePlanTool, updatePlanTool } from './proposePlan';
import { readFileTool } from './readFile';
import { runCommandTool } from './runCommand';
import { runTestsTool } from './runTests';
import { searchFilesTool } from './searchFiles';
import { codebaseSearchTool } from './codebaseSearch';
import { writeFileTool } from './writeFile';
import { findLogsTool } from './findLogs';
import { readLogTailTool } from './readLogTail';
import { openBrowserTool } from './openBrowser';
import { fetchPageTool } from './fetchPage';
import { globTool, grepTool } from './globGrep';
import { fileSearchTool, webSearchTool } from './fileSearchWeb';
import { askQuestionTool, skillTool, todoReadTool, todoWriteTool } from './todoQuestionSkill';
import { callMcpToolTool, listMcpToolsTool } from './mcp';
import { awaitShellTool, taskTool } from './taskShell';
import type { TodoStore } from '../todoStore';
import type { ShellSession } from '../shellSession';
import type { TaskToolContext } from './taskShell';

export type ExtendedToolContext = ToolContext & TaskToolContext & {
	sessionAllow?: string[];
	onAlwaysAllow?: (pattern: string) => void;
	todos?: TodoStore;
	skipConfirm?: boolean;
	shell?: ShellSession;
	subagentDepth?: number;
};

const TOOLS: ToolDefinition[] = [
	getWorkspaceInfoTool,
	getActiveEditorTool,
	getOpenEditorsTool,
	listDirTool,
	readFileTool,
	searchFilesTool,
	globTool,
	grepTool,
	fileSearchTool,
	codebaseSearchTool,
	findLogsTool,
	readLogTailTool,
	proposePlanTool,
	updatePlanTool,
	todoWriteTool,
	todoReadTool,
	askQuestionTool,
	skillTool,
	taskTool,
	listMcpToolsTool,
	callMcpToolTool,
	webSearchTool,
	writeFileTool,
	applyPatchTool,
	applyWorkspaceEditTool,
	deleteFileTool,
	createDirTool,
	openFileTool,
	closeFileTool,
	revealLineTool,
	openBrowserTool,
	fetchPageTool,
	gitStatusTool,
	getDiagnosticsTool,
	runCommandTool,
	awaitShellTool,
	runTestsTool,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function listAgentTools(): ToolDefinition[] {
	return TOOLS;
}

export function getAgentLlmTools(mode?: string, opts?: { readonly?: boolean; disableTask?: boolean }): LlmToolDefinition[] {
	const settings = getSettings();
	return TOOLS.filter((tool) => {
		if (!settings.enableFileReading && ['read_file', 'glob', 'grep', 'search_files', 'file_search', 'list_dir'].includes(tool.name)) {
			return false;
		}

		if (!settings.enableTerminal && ['run_command', 'run_tests', 'await_shell'].includes(tool.name)) {
			return false;
		}

		if (!settings.webSearchEnabled && tool.name === 'web_search') {
			return false;
		}

		if (!settings.webFetchEnabled && tool.name === 'fetch_page') {
			return false;
		}

		if (mode === 'plan' && isMutatingTool(tool.name)) {
			return false;
		}

		if (opts?.readonly && isMutatingTool(tool.name)) {
			return false;
		}

		if (opts?.readonly && ['run_command', 'run_tests', 'await_shell', 'open_browser', 'call_mcp_tool'].includes(tool.name)) {
			return false;
		}

		if (opts?.disableTask && tool.name === 'task') {
			return false;
		}

		return true;
	}).map(toLlmToolDefinition);
}

function subjectFromArgs(name: string, rawArguments: string): string {
	try {
		const args = parseToolArguments(rawArguments);
		if (typeof args.path === 'string') {
			return args.path;
		}

		if (typeof args.command === 'string') {
			return args.command;
		}

		if (typeof args.url === 'string') {
			return args.url;
		}

		if (typeof args.query === 'string') {
			return args.query;
		}

		if (typeof args.name === 'string') {
			return args.name;
		}
	} catch {
		return extractPathFromPartialJson(rawArguments) ?? name;
	}

	return name;
}

export async function executeAgentTool(name: string, rawArguments: string, ctx: ToolContext = {}): Promise<ToolResult> {
	const tool = BY_NAME.get(name);
	if (!tool) {
		return {
			ok: false,
			content: vscode.l10n.t('agent.unknownTool', name),
		};
	}

	const started = Date.now();
	const blocked = denyMutatingIfAuto(name);
	if (blocked) {
		logAgentTool({
			name,
			status: 'denied',
			ms: Date.now() - started,
			detail: rawArguments,
		});
		return blocked;
	}

	const settings = getSettings();
	const action = toolActionType(name);
	const subject = subjectFromArgs(name, rawArguments);
	const ext = ctx as ExtendedToolContext;
	// Здесь только центральный deny / session-allow; once/always UX остаётся в confirm-хелперах tools
	if (action && settings.agentAuthLevel !== 'open') {
		const decision = evaluateApproval(action, subject, settings.approvalPolicy, ext.sessionAllow);
		if (decision === 'deny') {
			const content = `Отклонено политикой подтверждений (${action}): ${subject}`;
			logAgentTool({
				name,
				status: 'denied',
				ms: Date.now() - started,
				detail: content
			});
			return {
				ok: false,
				denied: true,
				content
			};
		}

		if (decision === 'allow' || settings.autoApprove) {
			// Не дублировать confirm для allowlist / auto-approve
			(ext as { skipConfirm?: boolean }).skipConfirm = true;
		}
	}

	try {
		const args = parseToolArguments(rawArguments);
		if (isMutatingTool(name) && ctx.plan) {
			const blockedByPlan = ctx.plan.guard(mutationPathsFromArgs(name, args));
			if (blockedByPlan) {
				logAgentTool({
					name,
					status: 'denied',
					ms: Date.now() - started,
					detail: blockedByPlan.content,
				});
				return blockedByPlan;
			}
		}

		const result = await tool.execute(args, ctx);
		if (result.ok && isMutatingTool(name) && ctx.plan?.isApproved) {
			ctx.plan.markDoneByPaths(mutationPathsFromArgs(name, args));
			ctx.onPlanChanged?.();
		}
		
		if (result.content.length > settings.toolOutputMaxChars) {
			const over = result.content.length - settings.toolOutputMaxChars;
			result.content = `${result.content.slice(0, settings.toolOutputMaxChars)}\n\n[truncated ${over} chars]`;
		}

		logAgentTool({
			name,
			status: result.denied ? 'denied' : result.ok ? 'ok' : 'error',
			ms: Date.now() - started,
			detail: typeof args.command === 'string'
				? `${args.command} ${Array.isArray(args.args) ? args.args.join(' ') : ''}`.trim()
				: typeof args.path === 'string'
					? args.path
					: rawArguments,
		});
		return result;
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			logAgentTool({
				name,
				status: 'error',
				ms: Date.now() - started,
				detail: 'abort',
			});
			throw err;
		}

		logAgentTool({
			name,
			status: 'error',
			ms: Date.now() - started,
			detail: err instanceof Error ? err.message : String(err),
		});
		return {
			ok: false,
			path: extractPathFromPartialJson(rawArguments),
			content: err instanceof Error ? err.message : String(err),
		};
	}
}
