export type ApprovalMode = 'allow' | 'ask' | 'review' | 'deny';
export type ApprovalActionType = 'shell' | 'edits' | 'delete' | 'mcp' | 'web' | 'outside' | 'task' | 'skill';

export interface ApprovalRule {
	mode: ApprovalMode;
	allowlist: string[];
	denylist: string[];
}

export type ApprovalPolicy = Record<ApprovalActionType, ApprovalRule>;

const rule = (mode: ApprovalMode, allowlist: string[] = [], denylist: string[] = []): ApprovalRule => ({
	mode,
	allowlist,
	denylist,
});

/**
 * Базовая политика. 
 * Чувствительные пути (`.env*`) не кладём в denylist здесь:
 * их закрывает `sensitivePathPatterns` (ask/deny на запись) отдельно от пустого `deniedPaths`.
 * Примеры для UI «Вставить примеры» - `EXAMPLE_DENIED_PATHS` (`.env`, `.env.*`, ...).
 */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
	shell: rule('ask'),
	edits: rule('ask'),
	delete: rule('ask'),
	mcp: rule('ask'),
	web: rule('ask'),
	outside: rule('ask'),
	task: rule('ask'),
	skill: rule('allow'),
};
