import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { AGENT_LIMITS, previewText } from '../agent/policy';

const execFileAsync = promisify(execFile);

export type HookEvent = 'beforeSubmit' | 'beforeShell';

export interface HookCommand {
	command: string;
}

export interface ProjectHooks {
	beforeSubmit: HookCommand[];
	beforeShell: HookCommand[];
}

export interface HookRunResult {
	ok: boolean;
	vetoed: boolean;
	stderr?: string;
	stdout?: string;
	command?: string;
}

const MAX_HOOK_OUTPUT = 4_000;
const HOOK_TIMEOUT_MS = 15_000;

function asHookList(raw: unknown): HookCommand[] {
	if (!Array.isArray(raw)) {
		return [];
	}

	const out: HookCommand[] = [];
	for (const item of raw) {
		if (typeof item === 'string' && item.trim()) {
			out.push({ command: item.trim() });
			continue;
		}

		if (item && typeof item === 'object' && typeof (item as { command?: unknown }).command === 'string') {
			const command = String((item as { command: string }).command).trim();
			if (command) {
				out.push({ command });
			}
		}
	}
	return out;
}

// Загрузить `.gen/hooks.json` только из проекта
export async function loadProjectHooks(): Promise<ProjectHooks> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return { beforeSubmit: [], beforeShell: [] };
	}

	const uri = vscode.Uri.joinPath(folder.uri, '.gen', 'hooks.json');
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const raw = JSON.parse(new TextDecoder().decode(bytes)) as {
			hooks?: Record<string, unknown>;
			beforeSubmit?: unknown;
			beforeShell?: unknown;
		};
		const hooks = raw.hooks ?? raw;
		return {
			beforeSubmit: asHookList(hooks.beforeSubmit),
			beforeShell: asHookList(hooks.beforeShell),
		};
	} catch {
		return { beforeSubmit: [], beforeShell: [] };
	}
}

async function runShellHook(
	command: string,
	cwd: string,
	envExtra: Record<string, string>,
	signal?: AbortSignal,
): Promise<HookRunResult> {
	const isWin = process.platform === 'win32';
	const shell = isWin ? 'cmd.exe' : '/bin/sh';
	const args = isWin ? ['/d', '/s', '/c', command] : ['-c', command];
	try {
		const { stdout, stderr } = await execFileAsync(shell, args, {
			cwd,
			timeout: HOOK_TIMEOUT_MS,
			maxBuffer: AGENT_LIMITS.maxCommandOutput,
			signal,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NO_COLOR: '1',
				...envExtra,
			},
		});
		return {
			ok: true,
			vetoed: false,
			stdout: previewText(String(stdout ?? ''), MAX_HOOK_OUTPUT),
			stderr: previewText(String(stderr ?? ''), MAX_HOOK_OUTPUT),
			command,
		};
	} catch (err) {
		const execErr = err as NodeJS.ErrnoException & {
			code?: number | string;
			stdout?: string;
			stderr?: string;
			killed?: boolean;
		};
		if (execErr.name === 'AbortError' || signal?.aborted) {
			const abortErr = new Error(vscode.l10n.t('agent.operationCancelled'));
			abortErr.name = 'AbortError';
			throw abortErr;
		}

		const stderr = previewText(String(execErr.stderr ?? execErr.message ?? err), MAX_HOOK_OUTPUT);
		return {
			ok: false,
			vetoed: true,
			stdout: previewText(String(execErr.stdout ?? ''), MAX_HOOK_OUTPUT),
			stderr,
			command,
		};
	}
}

export async function runHookEvent(
	event: HookEvent,
	envExtra: Record<string, string> = {},
	signal?: AbortSignal,
): Promise<HookRunResult> {
	const hooks = await loadProjectHooks();
	const list = event === 'beforeSubmit' ? hooks.beforeSubmit : hooks.beforeShell;
	if (list.length === 0) {
		return { ok: true, vetoed: false };
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	const cwd = folder?.uri.fsPath ?? process.cwd();

	for (const item of list) {
		const result = await runShellHook(item.command, cwd, {
			GEN_HOOK_EVENT: event,
			...envExtra,
		}, signal);
		if (result.vetoed || !result.ok) {
			return {
				...result,
				vetoed: true,
				stderr: result.stderr?.trim()
					|| vscode.l10n.t('chat.hooks.veto', event, item.command),
			};
		}
	}

	return { ok: true, vetoed: false };
}

export async function runBeforeSubmitHook(text: string, signal?: AbortSignal): Promise<HookRunResult> {
	return runHookEvent('beforeSubmit', {
		GEN_HOOK_TEXT: text.slice(0, 4_000),
	}, signal);
}

export async function runBeforeShellHook(commandLine: string, signal?: AbortSignal): Promise<HookRunResult> {
	return runHookEvent('beforeShell', {
		GEN_HOOK_COMMAND: commandLine.slice(0, 2_000),
	}, signal);
}
