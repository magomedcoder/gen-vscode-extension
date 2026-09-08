import * as path from 'node:path';
import * as vscode from 'vscode';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { pathExists, resolveWorkspacePath, throwIfAborted } from '../../workspacePath';
import { runShellCommand } from '../../shellExec';
import { confirmAlwaysOrSkip } from '../confirm';
import { toPosixRelative } from '../../policy';

const SCRATCH_PREFIX = '.gen/scratch/';

const RUNNERS: Record<string, { command: string; argsPrefix: string[] }> = {
	'.js': { command: 'node', argsPrefix: [] },
	'.mjs': { command: 'node', argsPrefix: [] },
	'.cjs': { command: 'node', argsPrefix: [] },
	// Node 22+: strip types без отдельного transpile / npx
	'.ts': { command: 'node', argsPrefix: ['--experimental-strip-types'] },
	'.py': { command: 'python3', argsPrefix: [] },
	'.sh': { command: 'bash', argsPrefix: [] },
};

function isUnderScratch(relative: string): boolean {
	const norm = toPosixRelative(relative).replace(/^\.\//, '');
	return norm === '.gen/scratch' || norm.startsWith(SCRATCH_PREFIX);
}

// Запуск одноразового скрипта только из `.gen/scratch/**` (не eval произвольного JS)
export const runScratchTool: ToolDefinition = {
	name: 'run_scratch',
	description: 'Запустить файл из `.gen/scratch/` (node/python/bash по расширению). Только пути под `.gen/scratch/**`; с подтверждением.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь относительно workspace, обязан быть под `.gen/scratch/`',
			},
			args: {
				type: 'array',
				items: { type: 'string' },
				description: 'Аргументы скрипту',
			},
			timeout_ms: {
				type: 'integer',
				description: 'Таймаут мс (по умолчанию как у run_command)',
			},
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		const relative = toPosixRelative(resolved.relative);

		if (!isUnderScratch(relative)) {
			return {
				ok: false,
				denied: true,
				path: relative,
				content: `run_scratch: путь должен быть под ${SCRATCH_PREFIX}** (получено: ${relative})`,
			};
		}

		if (!(await pathExists(resolved.uri))) {
			return {
				ok: false,
				path: relative,
				content: vscode.l10n.t('tool.fileNotFound', relative),
			};
		}

		const ext = path.posix.extname(relative).toLowerCase();
		const runner = RUNNERS[ext];
		if (!runner) {
			return {
				ok: false,
				path: relative,
				content: `run_scratch: расширение «${ext || '(нет)'}» не поддерживается (ожидаются ${Object.keys(RUNNERS).join(', ')})`,
			};
		}

		const scriptArgs = Array.isArray(args.args)
			? args.args.filter((item): item is string => typeof item === 'string')
			: [];
		const timeoutMs = asOptionalInt(args, 'timeout_ms');
		const commandLine = `${runner.command} ${[...runner.argsPrefix, relative, ...scriptArgs].join(' ')}`;

		const denied = await confirmAlwaysOrSkip(
			ctx,
			vscode.l10n.t('agent.confirm.runCommand', relative),
			commandLine,
		);
		if (denied) {
			return {
				...denied,
				path: relative,
			};
		}

		const cwd = resolved.folder.uri.fsPath;
		const result = await runShellCommand({
			command: runner.command,
			args: [...runner.argsPrefix, resolved.uri.fsPath, ...scriptArgs],
			cwd,
			timeoutMs,
			signal: ctx.signal,
		});

		return {
			ok: result.ok,
			path: relative,
			content: result.content,
		};
	},
};
