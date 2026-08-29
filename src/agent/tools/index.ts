import * as vscode from 'vscode';
import type { LlmToolDefinition } from '../../llm/types';
import { logAgentTool } from '../audit';
import { denyMutatingIfAuto, isMutatingTool } from '../auth';
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

const TOOLS: ToolDefinition[] = [
	getWorkspaceInfoTool,
	getActiveEditorTool,
	getOpenEditorsTool,
	listDirTool,
	readFileTool,
	searchFilesTool,
	codebaseSearchTool,
	findLogsTool,
	readLogTailTool,
	proposePlanTool,
	updatePlanTool,
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
	runTestsTool,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function listAgentTools(): ToolDefinition[] {
	return TOOLS;
}

export function getAgentLlmTools(): LlmToolDefinition[] {
	return TOOLS.map(toLlmToolDefinition);
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
			detail: rawArguments
		});
		return blocked;
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
				detail: 'abort'
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
