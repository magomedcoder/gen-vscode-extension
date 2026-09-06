import * as vscode from 'vscode';
import type { LlmToolDefinition } from '../../llm/types';
import { getSettings } from '../../config/settings';
import { logAgentTool } from '../audit';
import { isMutatingTool } from '../auth';
import { evaluateApproval, matchesSensitivePath, suggestPattern, toolActionType } from '../permissionPolicy';
import { mutationPathsFromArgs } from '../plan';
import { isOutsideWorkspaceInput, pathIsInside } from '../policy';
import { getAgentRoot } from '../agentRoot';
import { extractPathFromPartialJson, parseToolArguments, toLlmToolDefinition, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { includeApplyPatchForModel } from '../modelRoutedPatch';
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
import { listPluginsTool, pluginTool } from './plugins';
import { callMcpToolTool, listMcpToolsTool } from './mcp';
import { executeSubjectFromArgs, executeTool, mcpCallSubjectFromArgs } from './execute';
import { awaitShellTool, taskTool } from './taskShell';
import { editNotebookTool } from './editNotebook';
import { lspTool } from './lsp';
import { planEnterTool, planExitTool, switchModeTool } from './modeSwitch';
import { listPlansTool, writePlanTool } from './writePlan';
import { generateAgentTool } from './generateAgent';
import { searchDocsTool, semanticSearchTool } from './semanticSearch';
import type { TodoStore } from '../todoStore';
import type { ShellSession } from '../shellSession';
import type { TaskToolContext } from './taskShell';
import type { ChatMode } from '../../config/types';

export type ExtendedToolContext = ToolContext & TaskToolContext & {
	sessionAllow?: string[];
	onAlwaysAllow?: (pattern: string) => void;
	// Паттерн для кнопки Always (из suggestPattern); читает confirmAlwaysOrSkip
	suggestAlwaysPattern?: string;
	todos?: TodoStore;
	// Mid-run вопрос пользователю (ask_question)
	askQuestion?(request: {
		title: string;
		questions: Array<{ id: string; prompt: string; options?: string[] }>;
	}): Promise<Record<string, string>>;
	skipConfirm?: boolean;
	// Принудительный confirm (например shell в Plan), даже при autoApprove
	forceConfirm?: boolean;
	shell?: ShellSession;
	subagentDepth?: number;
	// Смена режима чата из tools plan_enter / plan_exit / switch_mode
	setChatMode?: (mode: ChatMode) => void | Promise<void>;
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
	semanticSearchTool,
	searchDocsTool,
	findLogsTool,
	readLogTailTool,
	proposePlanTool,
	updatePlanTool,
	writePlanTool,
	listPlansTool,
	planEnterTool,
	planExitTool,
	switchModeTool,
	todoWriteTool,
	todoReadTool,
	askQuestionTool,
	skillTool,
	listPluginsTool,
	pluginTool,
	taskTool,
	generateAgentTool,
	listMcpToolsTool,
	callMcpToolTool,
	executeTool,
	webSearchTool,
	writeFileTool,
	applyPatchTool,
	applyWorkspaceEditTool,
	editNotebookTool,
	deleteFileTool,
	createDirTool,
	openFileTool,
	closeFileTool,
	revealLineTool,
	openBrowserTool,
	fetchPageTool,
	gitStatusTool,
	getDiagnosticsTool,
	lspTool,
	runCommandTool,
	awaitShellTool,
	runTestsTool,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getAgentLlmTools(mode?: string, opts?: {
	readonly?: boolean;
	disableTask?: boolean;
	primary?: boolean;
	// Id модели текущего run (для model-routed patch)
	modelId?: string;
}): LlmToolDefinition[] {
	const settings = getSettings();
	const modelId = opts?.modelId ?? settings.model;
	const keepApplyPatch = includeApplyPatchForModel(modelId, settings.modelRoutedPatch);
	const filtered = TOOLS.filter((tool) => {
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

		// Experimental code-mode: opt-in; не отдаём модели, пока выключено
		if (!settings.codeModeEnabled && tool.name === 'execute') {
			return false;
		}

		if ((mode === 'plan' || mode === 'multitask') && isMutatingTool(tool.name)) {
			return false;
		}

		if (opts?.readonly && isMutatingTool(tool.name)) {
			return false;
		}

		const shellTool = ['run_command', 'run_tests', 'await_shell'].includes(tool.name);
		// Plan + planShellPolicy=ask: shell в списке; confirm принудительный в executeAgentTool
		const planShellAsk = mode === 'plan' && settings.planShellPolicy === 'ask' && shellTool;
		if (opts?.readonly && (shellTool || ['open_browser', 'call_mcp_tool', 'execute'].includes(tool.name))) {
			if (!planShellAsk) {
				return false;
			}
		}

		if (opts?.disableTask && tool.name === 'task') {
			return false;
		}

		// Model-routed patch: non-GPT без apply_patch (write/edit остаются)
		if (!keepApplyPatch && tool.name === 'apply_patch') {
			return false;
		}

		return true;
	});

	// primaryTools: только для primary-агента (не readonly / не субагент)
	const applyPrimary = opts?.primary !== false && !opts?.readonly && settings.primaryTools.length > 0;
	if (!applyPrimary) {
		return filtered.map(toLlmToolDefinition);
	}

	const allow = new Set(settings.primaryTools.map((name) => name.trim()).filter(Boolean));
	// list_mcp_tools всегда доступен, чтобы можно было обнаружить MCP
	allow.add('list_mcp_tools');
	const primaryFiltered = filtered.filter((tool) => allow.has(tool.name));
	// пустой результат после фильтра - откат ко всем (essential fallback)
	const result = primaryFiltered.length > 0 ? primaryFiltered : filtered;
	return result.map(toLlmToolDefinition);
}

function subjectFromArgs(name: string, rawArguments: string): string {
	try {
		const args = parseToolArguments(rawArguments);
		if (name === 'call_mcp_tool') {
			return mcpCallSubjectFromArgs(args) ?? name;
		}

		if (name === 'execute') {
			return executeSubjectFromArgs(rawArguments) ?? name;
		}

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

function workspaceFoldersFs(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
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
	const settings = getSettings();
	let action = toolActionType(name);
	const subject = subjectFromArgs(name, rawArguments);
	const ext = ctx as ExtendedToolContext;
	const chatMode = settings.chatMode;
	const pathLike = Boolean(extractPathFromPartialJson(rawArguments) || (() => {
		try {
			const args = parseToolArguments(rawArguments);
			return typeof args.path === 'string';
		} catch {
			return false;
		}
	})());

	// Plan / Multitask: мутации всегда запрещены (даже если tool как-то вызвали)
	if ((chatMode === 'plan' || chatMode === 'multitask') && isMutatingTool(name)) {
		const content = chatMode === 'plan'
			? 'Режим Plan - только чтение и план. Правки файлов запрещены; переключись в Agent (`plan_exit` / `/agent`).'
			: 'Режим Multitask - координатор без прямых правок. Делегируй через task или перейди в Agent.';
		logAgentTool({
			name,
			status: 'denied',
			ms: Date.now() - started,
			detail: content,
		});
		return {
			ok: false,
			denied: true,
			content,
		};
	}

	// Plan + deny: shell недоступен
	if (chatMode === 'plan' && action === 'shell' && settings.planShellPolicy === 'deny') {
		const content = 'Режим Plan (planShellPolicy=deny): shell недоступен. Переключись в Agent (`plan_exit` / `/agent`) или смени planShellPolicy на ask.';
		logAgentTool({
			name,
			status: 'denied',
			ms: Date.now() - started,
			detail: content,
		});
		return {
			ok: false,
			denied: true,
			content,
		};
	}

	// external_directory: путь вне workspace -> action `outside` или deny
	// Исключение: cwd субагента в git worktree (может быть sibling вне workspace folders)
	if (pathLike && (action === 'edits' || action === 'delete' || name === 'read_file' || name === 'list_dir' || name === 'open_file' || name === 'create_dir' || name === 'apply_patch' || name === 'apply_workspace_edit' || name === 'write_file' || name === 'delete_file' || name === 'edit_notebook')) {
		const agentRoot = getAgentRoot();
		const insideAgentRoot = Boolean(agentRoot && subject && (pathIsInside(subject, agentRoot) || !subject.includes('/') && !subject.includes('\\')));
		const outside = !insideAgentRoot && isOutsideWorkspaceInput(subject, workspaceFoldersFs());
		if (outside) {
			if (!settings.allowExternalDirectory) {
				const content = `Отклонено: путь вне workspace (allowExternalDirectory=false): ${subject}`;
				logAgentTool({
					name,
					status: 'denied',
					ms: Date.now() - started,
					detail: content,
				});
				return {
					ok: false,
					denied: true,
					content,
				};
			}

			action = 'outside';
		}
	}

	// Паттерн Always для confirmAlwaysOrSkip (после remapping outside)
	ext.suggestAlwaysPattern = action ? suggestPattern(action, name, subject) : undefined;

	// Чувствительные пути (.env*): force ask/deny на запись/удаление
	const sensitiveWrite = Boolean(
		action
		&& (action === 'edits' || action === 'delete' || action === 'outside')
		&& matchesSensitivePath(subject, settings.sensitivePathPatterns),
	);

	// Plan + ask: shell всегда с confirm (не allow / autoApprove)
	const planShellForceAsk = chatMode === 'plan' && action === 'shell' && settings.planShellPolicy === 'ask';

	// permission.task / субагенты: чуть строже (не наследовать sessionAllow, не auto-skip confirm)
	const nestedStrict = (ext.subagentDepth ?? 0) > 0;

	// Здесь только центральный deny / session-allow; once/always UX остаётся в confirm-хелперах tools
	if (action) {
		let decision = evaluateApproval(action, subject, settings.approvalPolicy, nestedStrict ? undefined : ext.sessionAllow);
		if (sensitiveWrite && decision === 'allow') {
			decision = 'ask';
		}

		if (planShellForceAsk && decision === 'allow') {
			decision = 'ask';
		}

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

		const canSkip = decision === 'allow' || settings.autoApprove;
		if (canSkip && !sensitiveWrite && !planShellForceAsk && !(nestedStrict && isMutatingTool(name))) {
			// Не дублировать confirm для allowlist / auto-approve (не .env*, не Plan shell, не мутации субагента)
			ext.skipConfirm = true;
		}
	}

	if (planShellForceAsk) {
		// Plan shell: всегда confirm (в т.ч. при autoApprove / allow)
		ext.forceConfirm = true;
		ext.skipConfirm = false;
	} else {
		ext.forceConfirm = false;
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
