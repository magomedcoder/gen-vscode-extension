import { detectTestCommand } from '../detectTestCommand';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { resolveCommandCwd, throwIfAborted } from '../workspacePath';
import { runShellCommand } from '../shellExec';
import { confirmAlwaysOrSkip } from './confirm';

export const runTestsTool: ToolDefinition = {
	name: 'run_tests',
	description: 'Запустить тесты проекта (npm/yarn/pnpm test, go test, cargo test, pytest и т.п.). Всегда требует подтверждения.',
	parameters: {
		type: 'object',
		properties: {
			cwd: {
				type: 'string',
				description: 'Каталог проекта относительно workspace (по умолчанию корень)',
			},
			timeout_ms: {
				type: 'integer',
				description: 'Таймаут в миллисекундах (по умолчанию 120000, максимум 300000)',
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveCommandCwd(asString(args, 'cwd', '.'));
		const cwd = resolved.cwd;
		const detected = await detectTestCommand(cwd);
		if (!detected) {
			return {
				ok: false,
				path: resolved.relative,
				content: 'Не удалось определить команду тестов (package.json scripts.test, go.mod, Cargo.toml, pytest.ini, manage.py). Используйте run_command явно.',
			};
		}

		const denied = await confirmAlwaysOrSkip(ctx, `Запустить тесты в ${resolved.relative || '.'}?`, detected.label);
		if (denied) {
			return {
				...denied,
				path: resolved.relative,
			};
		}

		const result = await runShellCommand({
			command: detected.command,
			args: detected.args,
			cwd,
			timeoutMs: asOptionalInt(args, 'timeout_ms') ?? 120_000,
			signal: ctx.signal,
		});

		return {
			ok: result.ok,
			path: resolved.relative,
			content: `${detected.label}\n${result.content}`,
		};
	},
};
