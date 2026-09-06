import { getSettings } from '../../../../core/config/settings';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';
import { listSubagentIds, resolveSubagent } from '../../subagents';
import { createAgentWorktree, shouldUseWorktree } from '../../worktree';
import { confirmAlwaysOrSkip } from '../confirm';

export interface TaskToolContext extends ToolContext {
	runSubagent?(params: {
		type: string;
		prompt: string;
		signal: AbortSignal;
		// Cwd субагента (git worktree)
		cwd?: string;
	}): Promise<string>;
	subagentDepth?: number;
}

export const taskTool: ToolDefinition = {
	name: 'task',
	description: 'Запустить субагента (explore | general | scout | docs-researcher | code-reviewer | кастомный из `.gen/agents/`) для подзадачи. Explore/scout/presets - read-only; general - полный набор tools. Опционально use_worktree - изолированный git worktree.',
	parameters: {
		type: 'object',
		properties: {
			subagent_type: {
				type: 'string',
				description: 'explore | general | scout | docs-researcher | code-reviewer | имя кастомного агента',
			},
			prompt: {
				type: 'string',
				description: 'Задание для субагента',
			},
			use_worktree: {
				type: 'boolean',
				description: 'Создать git worktree под `.gen/worktrees/` и запустить субагента с этим cwd. По умолчанию - настройка worktreesEnabled. false - всегда без worktree.',
			},
		},
		required: ['subagent_type', 'prompt'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const ext = ctx as TaskToolContext;
		const depth = ext.subagentDepth ?? 0;
		const maxDepth = getSettings().subagentDepth;
		if (depth >= maxDepth) {
			return {
				ok: false,
				content: `Достигнут лимит вложенности субагентов (${maxDepth})`,
			};
		}

		const type = asString(args, 'subagent_type').trim() || 'explore';
		const prompt = asString(args, 'prompt').trim();
		if (!prompt) {
			return {
				ok: false,
				content: 'task: нужен параметр prompt',
			};
		}

		const def = await resolveSubagent(type);
		if (!def) {
			const known = (await listSubagentIds()).join(', ');
			return {
				ok: false,
				content: `Неизвестный subagent_type "${type}". Доступно: ${known}`,
			};
		}

		if (!ext.runSubagent) {
			return {
				ok: false,
				content: 'Запуск субагента недоступен',
			};
		}

		// permission.task: confirmAlwaysOrSkip + evaluateApproval(action=task) в executeAgentTool.
		// Вложенный субагент не наследует sessionAllow родителя (строже) - см. AgentSession.runSubagent.
		const denied = await confirmAlwaysOrSkip(ctx, `Задача -> ${def.name}`, prompt.slice(0, 400));
		if (denied) {
			return denied;
		}

		let worktreeCwd: string | undefined;
		let worktreeMeta: Record<string, unknown> | undefined;
		if (shouldUseWorktree(args.use_worktree)) {
			const wt = await createAgentWorktree({
				taskId: def.id,
				signal: ctx.signal,
			});
			if (wt.ok && wt.cwd) {
				worktreeCwd = wt.cwd;
				worktreeMeta = {
					path: wt.cwd,
					branch: wt.branch,
					slug: wt.slug,
					detail: wt.detail,
				};
			} else if (wt.notGitRepo) {
				// Graceful: не git - обычный субагент
				worktreeMeta = {
					skipped: true,
					reason: wt.detail
				};
			} else {
				// Создание не удалось - продолжаем без worktree
				worktreeMeta = {
					skipped: true,
					reason: wt.detail
				};
			}
		}

		const worktreeNote = worktreeCwd ? `\n\n# Worktree\nРабочий каталог субагента: ${worktreeCwd}\nОтносительные пути и shell cwd - от этого каталога. Worktree не удаляется автоматически.` : '';

		try {
			const report = await ext.runSubagent({
				type: def.id,
				prompt: `${def.prompt}\n\n# Задание\n${prompt}${worktreeNote}`,
				signal: ctx.signal ?? new AbortController().signal,
				cwd: worktreeCwd,
			});
			return {
				ok: true,
				content: JSON.stringify({
					subagent: def.id,
					...(worktreeMeta ? {
						worktree: worktreeMeta
					} : {}),
					report,
				}, null, 2),
			};
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw err;
			}

			return {
				ok: false,
				content: err instanceof Error ? err.message : String(err),
			};
		}
	},
};

export const awaitShellTool: ToolDefinition = {
	name: 'await_shell',
	description: 'Дождаться фонового job от run_command (background=true), проверить статус по job_id, или дождаться regex в выводе (notify_on_output).',
	parameters: {
		type: 'object',
		properties: {
			job_id: {
				type: 'string',
				description: 'ID фоновой задачи от run_command (background=true)',
			},
			timeout_ms: {
				type: 'integer',
				description: 'Сколько ждать завершения или совпадения паттерна (по умолчанию 60000)',
			},
			notify_on_output: {
				type: 'string',
				description: 'Regex по полному буферу вывода job; при совпадении вернуть результат до exit (с учётом debounce_ms)',
			},
			debounce_ms: {
				type: 'integer',
				description: 'После совпадения: ждать столько мс без роста вывода (по умолчанию 0 - сразу; min 0)',
			},
		},
		required: ['job_id'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const shell = (ctx as ToolContext & { shell?: import('../../shellSession').ShellSession }).shell;
		if (!shell) {
			return {
				ok: false,
				content: 'Shell-сессия недоступна',
			};
		}

		const jobId = asString(args, 'job_id').trim();
		const job = shell.getJob(jobId);
		if (!job) {
			return {
				ok: false,
				content: `Неизвестный job_id: ${jobId}`,
			};
		}

		// Опциональный regex по job.output - вернуть до завершения процесса
		const patternRaw = asString(args, 'notify_on_output').trim();
		let notifyPattern: RegExp | undefined;
		if (patternRaw) {
			try {
				notifyPattern = new RegExp(patternRaw);
			} catch (err) {
				return {
					ok: false,
					content: `Некорректный regex notify_on_output: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
		}

		// мс без роста длины вывода после совпадения (MVP: debounce по last growth)
		const debounceMs = Math.max(0, asOptionalInt(args, 'debounce_ms') ?? 0);
		const timeoutMs = Math.min(300_000, Math.max(1000, Number(args.timeout_ms) || 60_000));
		const deadline = Date.now() + timeoutMs;
		let lastLen = job.output.length;
		let lastGrowthAt = Date.now();

		const matchedAndSettled = (): boolean => {
			if (!notifyPattern || !notifyPattern.test(job.output)) {
				return false;
			}

			// job завершён - рост больше не будет; debounce не ждём
			if (job.done || debounceMs === 0) {
				return true;
			}

			return Date.now() - lastGrowthAt >= debounceMs;
		};

		while (!job.done && Date.now() < deadline) {
			throwIfAborted(ctx.signal);
			const len = job.output.length;
			if (len !== lastLen) {
				lastLen = len;
				lastGrowthAt = Date.now();
			}

			if (matchedAndSettled()) {
				return {
					ok: true,
					content: `совпадение notify_on_output: /${patternRaw}/\n` + shell.formatJob(job) + (job.done ? '' : '\n(статус: ещё выполняется / совпал паттерн)'),
				};
			}
			await new Promise((r) => setTimeout(r, 200));
		}

		// Финальная проверка (exit или таймаут): паттерн мог совпасть на последнем чанке
		if (matchedAndSettled()) {
			return {
				ok: job.done ? job.exitCode === 0 : true,
				content: `совпадение notify_on_output: /${patternRaw}/\n` + shell.formatJob(job) + (job.done ? '' : '\n(статус: ещё выполняется / совпал паттерн)'),
			};
		}

		return {
			ok: job.done ? job.exitCode === 0 : true,
			content: shell.formatJob(job) + (job.done ? '' : '\n(статус: ещё выполняется / таймаут ожидания)'),
		};
	},
};
