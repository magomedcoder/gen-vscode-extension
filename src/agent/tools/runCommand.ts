import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { resolveCommandCwd, throwIfAborted } from '../workspacePath';
import { runShellCommand } from '../shellExec';
import { confirmAlwaysOrSkip } from './confirm';

function asStringArray(args: Record<string, unknown>, key: string): string[] {
	const value = args[key];
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is string => typeof item === 'string');
}

export const runCommandTool: ToolDefinition = {
	name: 'run_command',
	description: 'Запустить команду в каталоге workspace через execFile (без shell/pipe). Запрещены rm/curl/eval-флаги/install/git push. Всегда требует подтверждения.',
	parameters: {
		type: 'object',
		properties: {
			command: {
				type: 'string',
				description: 'Исполняемый файл (go, python, npm, ... - без allowlist языков)',
			},
			args: {
				type: 'array',
				items: { type: 'string' },
				description: 'Аргументы команды',
			},
			cwd: {
				type: 'string',
				description: 'Рабочий каталог относительно workspace (по умолчанию корень)',
			},
			timeout_ms: {
				type: 'integer',
				description: 'Таймаут в миллисекундах (по умолчанию 60000, максимум 300000)',
			},
		},
		required: ['command'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveCommandCwd(asString(args, 'cwd', '.'));
		const command = asString(args, 'command').trim();
		const cmdArgs = asStringArray(args, 'args');
		const timeoutMs = asOptionalInt(args, 'timeout_ms');
		const cwd = resolved.cwd;

		const denied = await confirmAlwaysOrSkip(ctx, `Запустить команду в ${resolved.relative || '.'}?`, `${command} ${cmdArgs.join(' ')}`.trim());
		if (denied) {
			return {
				...denied,
				path: resolved.relative,
			};
		}

		const result = await runShellCommand({
			command,
			args: cmdArgs,
			cwd,
			timeoutMs,
			signal: ctx.signal,
		});

		return {
			ok: result.ok,
			path: resolved.relative,
			content: result.content,
		};
	},
};
