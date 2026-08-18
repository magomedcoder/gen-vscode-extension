import { getSettings, type AgentAuthLevel } from '../config/settings';

const WRITE_TOOLS = new Set([
	'write_file',
	'apply_patch',
	'apply_workspace_edit',
	'create_dir',
]);

const DELETE_TOOLS = new Set(['delete_file']);

export function getAgentAuthLevel(): AgentAuthLevel {
	return getSettings().agentAuthLevel;
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
	if (getAgentAuthLevel() !== 'auto' || !isMutatingTool(name)) {
		return undefined;
	}

	return {
		ok: false,
		denied: true,
		content: 'Режим «Чтение»: правки и удаление запрещены. Переключите уровень доступа на «Спросить» или «Без спроса».',
	};
}
