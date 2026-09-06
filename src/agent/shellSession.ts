import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { assertAllowedCommand, formatCommandLine } from './commandPolicy';
import { AGENT_LIMITS, previewText } from './policy';

export interface BackgroundJob {
	id: string;
	commandLine: string;
	cwd: string;
	startedAt: number;
	done: boolean;
	exitCode?: number;
	output: string;
	error?: string;
}

// Сохраняет cwd между вызовами run_command и ведёт фоновые shell-задачи
export class ShellSession {
	cwd: string;
	private jobs = new Map<string, BackgroundJob>();
	private nextId = 1;

	constructor(rootCwd: string) {
		this.cwd = rootCwd;
	}

	resolveCwd(relativeOrAbs?: string): string {
		const raw = (relativeOrAbs ?? '').trim();
		if (!raw || raw === '.') {
			return this.cwd;
		}

		if (path.isAbsolute(raw)) {
			return raw;
		}

		return path.resolve(this.cwd, raw);
	}

	applyCd(command: string, args: string[]): void {
		if (command === 'cd' && args.length === 1) {
			this.cwd = this.resolveCwd(args[0]);
		}
	}

	startBackground(
		command: string,
		args: string[],
		cwd: string,
		signal?: AbortSignal,
		envExtra?: Record<string, string>,
	): BackgroundJob {
		assertAllowedCommand(command, args);
		const id = `job_${this.nextId++}`;
		const commandLine = formatCommandLine(command, args);
		const job: BackgroundJob = {
			id,
			commandLine,
			cwd,
			startedAt: Date.now(),
			done: false,
			output: '',
		};
		this.jobs.set(id, job);

		const proc = spawn(command, args, {
			cwd,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NO_COLOR: '1',
				...(envExtra ?? {}),
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const onChunk = (chunk: Buffer | string) => {
			job.output += String(chunk);
			if (job.output.length > AGENT_LIMITS.maxCommandOutput) {
				job.output = job.output.slice(-AGENT_LIMITS.maxCommandOutput);
			}
		};
		proc.stdout?.on('data', onChunk);
		proc.stderr?.on('data', onChunk);
		proc.on('close', (code) => {
			job.done = true;
			job.exitCode = code ?? 1;
		});
		proc.on('error', (err) => {
			job.done = true;
			job.exitCode = 1;
			job.error = err.message;
		});
		signal?.addEventListener('abort', () => {
			try {
				proc.kill('SIGKILL');
			} catch {}
		}, { once: true });

		return job;
	}

	getJob(id: string): BackgroundJob | undefined {
		return this.jobs.get(id);
	}

	formatJob(job: BackgroundJob): string {
		const lines = [
			`job: ${job.id}`,
			`$ ${job.commandLine}`,
			`cwd: ${job.cwd}`,
			job.done ? `exit: ${job.exitCode ?? '?'}` : 'статус: выполняется',
		];
		if (job.error) {
			lines.push(`ошибка: ${job.error}`);
		}

		if (job.output.trim()) {
			lines.push('вывод:', previewText(job.output.trimEnd(), AGENT_LIMITS.maxCommandOutput));
		}
		
		return lines.join('\n');
	}
}

export function defaultWorkspaceCwd(): string {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}
