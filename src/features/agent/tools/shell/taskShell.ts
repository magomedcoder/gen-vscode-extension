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
		jobId?: string;
	}): Promise<string>;
	onSubagentJob?(event: {
		id: string;
		status: 'running' | 'done' | 'error' | 'aborted';
		subagent: string;
		promptPreview: string;
		detail?: string;
	}): void;
	subagentDepth?: number;
}

function asStringList(args: Record<string, unknown>, key: string): string[] {
	const raw = args[key];
	if (Array.isArray(raw)) {
		return raw.map((v) => String(v ?? '').trim()).filter(Boolean);
	}

	return [];
}

async function runOneSubagent(
	ext: TaskToolContext,
	def: {
		id: string;
		name: string;
		prompt: string
	},
	prompt: string,
	ctx: ToolContext,
	worktreeCwd: string | undefined,
	jobId: string,
): Promise<{ ok: boolean; jobId: string; subagent: string; report?: string; error?: string }> {
	ext.onSubagentJob?.({
		id: jobId,
		status: 'running',
		subagent: def.id,
		promptPreview: prompt.slice(0, 200),
	});
	const worktreeNote = worktreeCwd
		? `\n\n# Worktree\nРабочий каталог субагента: ${worktreeCwd}\nОтносительные пути и shell cwd - от этого каталога. Worktree не удаляется автоматически.`
		: '';
	try {
		const report = await ext.runSubagent!({
			type: def.id,
			prompt: `${def.prompt}\n\n# Задание\n${prompt}${worktreeNote}`,
			signal: ctx.signal ?? new AbortController().signal,
			cwd: worktreeCwd,
			jobId,
		});
		ext.onSubagentJob?.({
			id: jobId,
			status: 'done',
			subagent: def.id,
			promptPreview: prompt.slice(0, 200),
		});
		return {
			ok: true,
			jobId,
			subagent: def.id,
			report
		};
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			ext.onSubagentJob?.({
				id: jobId,
				status: 'aborted',
				subagent: def.id,
				promptPreview: prompt.slice(0, 200),
			});
			throw err;
		}
		const message = err instanceof Error ? err.message : String(err);
		ext.onSubagentJob?.({
			id: jobId,
			status: 'error',
			subagent: def.id,
			promptPreview: prompt.slice(0, 200),
			detail: message,
		});
		return {
			ok: false,
			jobId,
			subagent: def.id,
			error: message
		};
	}
}

export const taskTool: ToolDefinition = {
	name: 'task',
	description: 'Запустить субагента (explore | general | scout | docs-researcher | code-reviewer | кастомный из `.gen/agents/`) для подзадачи. Explore/scout/presets - read-only; general - полный набор tools. Параллельный research: передай prompts[] (только readonly субагенты). Опционально use_worktree - изолированный git worktree.',
	parameters: {
		type: 'object',
		properties: {
			subagent_type: {
				type: 'string',
				description: 'explore | general | scout | docs-researcher | code-reviewer | имя кастомного агента',
			},
			prompt: {
				type: 'string',
				description: 'Задание для субагента (один). Для fan-out используй prompts[].',
			},
			prompts: {
				type: 'array',
				items: { type: 'string' },
				description: 'Параллельные research-задания (readonly subagent only). Результат - агрегированный JSON.',
			},
			max_parallel: {
				type: 'integer',
				description: 'Макс. одновременных субагентов для prompts[] (по умолчанию 3, max 6)',
			},
			use_worktree: {
				type: 'boolean',
				description: 'Создать git worktree под `.gen/worktrees/` и запустить субагента с этим cwd. По умолчанию - настройка worktreesEnabled. false - всегда без worktree. Для prompts[] worktree не создаётся.',
			},
		},
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
		const prompts = asStringList(args, 'prompts');
		const single = asString(args, 'prompt').trim();
		if (single && prompts.length === 0) {
			prompts.push(single);
		}

		if (prompts.length === 0) {
			return {
				ok: false,
				content: 'task: нужен параметр prompt или prompts[]',
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

		const parallel = prompts.length > 1;
		if (parallel && def.readonly === false) {
			return {
				ok: false,
				content:
					'Параллельный fan-out (prompts[]) разрешён только для read-only субагентов (explore/scout/presets). Для general запускай по одному.',
			};
		}

		const denied = await confirmAlwaysOrSkip(
			ctx,
			parallel ? `Research *${prompts.length} -> ${def.name}` : `Задача -> ${def.name}`,
			prompts.map((p, i) => `${i + 1}. ${p.slice(0, 120)}`).join('\n').slice(0, 600),
		);
		if (denied) {
			return denied;
		}

		if (parallel) {
			const maxParallel = Math.min(6, Math.max(1, asOptionalInt(args, 'max_parallel') ?? 3));
			const results: Array<{ ok: boolean; jobId: string; subagent: string; report?: string; error?: string }> = [];
			let cursor = 0;
			const workers = Array.from({ length: Math.min(maxParallel, prompts.length) }, async () => {
				while (cursor < prompts.length) {
					throwIfAborted(ctx.signal);
					const idx = cursor;
					cursor += 1;
					const prompt = prompts[idx]!;
					const jobId = `research-${Date.now().toString(36)}-${idx}`;
					results[idx] = await runOneSubagent(ext, def, prompt, ctx, undefined, jobId);
				}
			});
			await Promise.all(workers);

			const synthesizeHint = getSettings().chatMode === 'project'
				? '\n\n[team-lead] Параллельный research завершён. Синтезируй отчёт в общий план/итог; не оставляй сырой вывод без сводки.'
				: '\n\nСинтезируй результаты research в краткий ответ пользователю.';

			const okCount = results.filter((r) => r?.ok).length;
			return {
				ok: okCount > 0,
				content:
					JSON.stringify(
						{
							parallel: true,
							subagent: def.id,
							maxParallel,
							okCount,
							total: prompts.length,
							results,
						},
						null,
						2,
					) + synthesizeHint,
			};
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
				worktreeMeta = {
					skipped: true,
					reason: wt.detail,
				};
			} else {
				worktreeMeta = {
					skipped: true,
					reason: wt.detail,
				};
			}
		}

		const jobId = `task-${Date.now().toString(36)}`;
		const one = await runOneSubagent(ext, def, prompts[0]!, ctx, worktreeCwd, jobId);
		if (!one.ok) {
			return {
				ok: false,
				content: one.error ?? 'subagent failed',
			};
		}

		const synthesizeHint = getSettings().chatMode === 'project'
				? '\n\n[team-lead] Субагент завершил задачу. Синтезируй отчёт в общий план/итог для пользователя; не оставляй сырой вывод без сводки.'
				: '';
		return {
			ok: true,
			content:
				JSON.stringify(
					{
						subagent: def.id,
						jobId,
						...(worktreeMeta ? { worktree: worktreeMeta } : {}),
						report: one.report,
					},
					null,
					2,
				) + synthesizeHint,
		};
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

		const debounceMs = Math.max(0, asOptionalInt(args, 'debounce_ms') ?? 0);
		const timeoutMs = Math.min(300_000, Math.max(1000, Number(args.timeout_ms) || 60_000));
		const deadline = Date.now() + timeoutMs;
		let lastLen = job.output.length;
		let lastGrowthAt = Date.now();

		const matchedAndSettled = (): boolean => {
			if (!notifyPattern || !notifyPattern.test(job.output)) {
				return false;
			}

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
					content: `совпадение notify_on_output: /${patternRaw}/\n` +
						shell.formatJob(job) +
						(job.done ? '' : '\n(статус: ещё выполняется / совпал паттерн)'),
				};
			}
			await new Promise((r) => setTimeout(r, 200));
		}

		if (matchedAndSettled()) {
			return {
				ok: job.done ? job.exitCode === 0 : true,
				content: `совпадение notify_on_output: /${patternRaw}/\n` +
					shell.formatJob(job) +
					(job.done ? '' : '\n(статус: ещё выполняется / совпал паттерн)'),
			};
		}

		return {
			ok: job.done ? job.exitCode === 0 : true,
			content: shell.formatJob(job) + (job.done ? '' : '\n(статус: ещё выполняется / таймаут ожидания)'),
		};
	},
};
