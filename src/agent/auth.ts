import * as vscode from 'vscode';
import { getSettings, type AgentAuthLevel } from '../config/settings';

const WRITE_TOOLS = new Set([
	'write_file',
	'apply_patch',
	'apply_workspace_edit',
	'create_dir',
]);

const DELETE_TOOLS = new Set(['delete_file']);
const TERMINAL_TOOLS = new Set(['run_command', 'run_tests']);

export function getAgentAuthLevel(): AgentAuthLevel {
	return getSettings().agentAuthLevel;
}

export function isTerminalTool(name: string): boolean {
	return TERMINAL_TOOLS.has(name);
}

export function isMutatingTool(name: string): boolean {
	return WRITE_TOOLS.has(name) || DELETE_TOOLS.has(name);
}

export function shouldConfirmWrites(): boolean {
	return getAgentAuthLevel() === 'ask';
}

export function shouldConfirmDeletes(): boolean {
	return getAgentAuthLevel() === 'ask';
}

export function denyMutatingIfAuto(name: string): { ok: false; denied: true; content: string } | undefined {
	if (getAgentAuthLevel() !== 'auto') {
		return undefined;
	}

	if (!isMutatingTool(name) && !isTerminalTool(name)) {
		return undefined;
	}

	const hint = isTerminalTool(name)
		? vscode.l10n.t('agent.auth.readOnlyTerminal')
		: vscode.l10n.t('agent.auth.readOnlyMutating');

	return {
		ok: false,
		denied: true,
		content: hint,
	};
}
