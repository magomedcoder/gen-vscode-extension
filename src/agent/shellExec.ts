import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertAllowedCommand, CommandPolicyError, formatCommandLine } from './commandPolicy';
import { AGENT_LIMITS, previewText } from './policy';

const execFileAsync = promisify(execFile);

export interface ShellExecRequest {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface ShellExecResult {
	ok: boolean;
	exitCode: number;
	content: string;
	commandLine: string;
}

function clampTimeout(ms: number | undefined): number {
	const value = ms ?? AGENT_LIMITS.defaultCommandTimeoutMs;
	return Math.min(AGENT_LIMITS.maxCommandTimeoutMs, Math.max(1000, Math.floor(value)));
}

function formatExecOutput(params: {
	commandLine: string;
	cwd: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	truncated?: boolean;
}): string {
	const lines = [
		`$ ${params.commandLine}`,
		`cwd: ${params.cwd}`,
		`exit: ${params.exitCode}`,
	];

	if (params.stdout.trim()) {
		lines.push('stdout:', params.stdout.trimEnd());
	}

	if (params.stderr.trim()) {
		lines.push('stderr:', params.stderr.trimEnd());
	}

	if (params.truncated) {
		lines.push(`... [вывод обрезан, лимит ${AGENT_LIMITS.maxCommandOutput} символов]`);
	}

	return lines.join('\n');
}

export async function runShellCommand(request: ShellExecRequest): Promise<ShellExecResult> {
	const args = request.args ?? [];
	assertAllowedCommand(request.command, args);

	const commandLine = formatCommandLine(request.command, args);
	const timeout = clampTimeout(request.timeoutMs);

	try {
		const { stdout, stderr } = await execFileAsync(request.command, args, {
			cwd: request.cwd,
			timeout,
			maxBuffer: AGENT_LIMITS.maxCommandOutput,
			signal: request.signal,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NO_COLOR: '1',
			},
		});

		const body = formatExecOutput({
			commandLine,
			cwd: request.cwd,
			exitCode: 0,
			stdout: String(stdout ?? ''),
			stderr: String(stderr ?? ''),
		});

		return {
			ok: true,
			exitCode: 0,
			content: previewText(body, AGENT_LIMITS.maxCommandOutput),
			commandLine,
		};
	} catch (err) {
		const execErr = err as NodeJS.ErrnoException & {
			code?: number | string;
			stdout?: string;
			stderr?: string;
			killed?: boolean;
			signal?: string;
		};

		if (execErr.name === 'AbortError' || request.signal?.aborted) {
			const abortErr = new Error('Операция отменена');
			abortErr.name = 'AbortError';
			throw abortErr;
		}

		if (execErr instanceof CommandPolicyError) {
			return {
				ok: false,
				exitCode: 1,
				content: execErr.message,
				commandLine,
			};
		}

		const exitCode = typeof execErr.code === 'number' ? execErr.code : 1;
		const stdout = String(execErr.stdout ?? '');
		const stderr = String(execErr.stderr ?? '');
		const timedOut = execErr.killed && execErr.signal === 'SIGTERM';
		const msg = execErr instanceof Error ? execErr.message : String(err);

		const body = formatExecOutput({
			commandLine,
			cwd: request.cwd,
			exitCode,
			stdout,
			stderr: timedOut ? `${stderr}\nТаймаут ${timeout} мс`.trim() : stderr || msg,
		});

		return {
			ok: false,
			exitCode,
			content: previewText(body, AGENT_LIMITS.maxCommandOutput),
			commandLine,
		};
	}
}
