import type { ApprovalPolicy } from '../config/approvalTypes';
import { getSettings } from '../config/settings';

const WRITE_TOOLS = new Set([
	'write_file',
	'apply_patch',
	'apply_workspace_edit',
	'create_dir',
	'edit_notebook',
]);

const DELETE_TOOLS = new Set(['delete_file']);

export function isMutatingTool(name: string): boolean {
	return WRITE_TOOLS.has(name) || DELETE_TOOLS.has(name);
}

/**
 * Confirm на запись/удаление всегда через confirmOrSkip:
 * skip - `skipConfirm` / `autoApprove` / approvalPolicy allow в executeAgentTool.
 */
export function shouldConfirmWrites(): boolean {
	return true;
}

export function shouldConfirmDeletes(): boolean {
	return true;
}

// Режим «только чтение»: edits/delete/shell в approvalPolicy = deny
export function isReadOnlyApprovalPolicy(policy: ApprovalPolicy = getSettings().approvalPolicy): boolean {
	return policy.edits.mode === 'deny' && policy.delete.mode === 'deny' && policy.shell.mode === 'deny';
}
