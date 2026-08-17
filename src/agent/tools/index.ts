import type { LlmToolDefinition } from '../../llm/types';
import { parseToolArguments, toLlmToolDefinition, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
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
import { readFileTool } from './readFile';
import { searchFilesTool } from './searchFiles';
import { writeFileTool } from './writeFile';

const TOOLS: ToolDefinition[] = [
	getWorkspaceInfoTool,
	getActiveEditorTool,
	getOpenEditorsTool,
	listDirTool,
	readFileTool,
	searchFilesTool,
	writeFileTool,
	applyPatchTool,
	applyWorkspaceEditTool,
	deleteFileTool,
	createDirTool,
	openFileTool,
	closeFileTool,
	revealLineTool,
	gitStatusTool,
	getDiagnosticsTool,
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
			content: `Неизвестный инструмент: ${name}`,
		};
	}

	try {
		const args = parseToolArguments(rawArguments);
		return await tool.execute(args, ctx);
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw err;
		}

		return {
			ok: false,
			content: err instanceof Error ? err.message : String(err),
		};
	}
}
