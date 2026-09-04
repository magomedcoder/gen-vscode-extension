import * as vscode from 'vscode';
import { getSettings } from '../../config/settings';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { throwIfAborted } from '../workspacePath';
import { getSubagent } from '../subagents';
import { confirmAlwaysOrSkip } from './confirm';

export interface TaskToolContext extends ToolContext {
	runSubagent?(params: {
		type: string;
		prompt: string;
		signal: AbortSignal;
	}): Promise<string>;
	subagentDepth?: number;
}

export const taskTool: ToolDefinition = {
	name: 'task',
	description: 'Запустить субагента (explore | general) для подзадачи. Explore - только чтение; general - полный набор tools.',
	parameters: {
		type: 'object',
		properties: {
			subagent_type: {
				type: 'string',
				description: 'explore | general',
			},
			prompt: {
				type: 'string',
				description: 'Задание для субагента',
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
				content: `Достигнут лимит вложенности субагентов (${maxDepth})`
			};
		}
		
		const type = asString(args, 'subagent_type').trim() || 'explore';
		const prompt = asString(args, 'prompt').trim();
		if (!prompt) {
			return {
				ok: false,
				content: 'task: нужен параметр prompt'
			};
		}

		const def = getSubagent(type);
		if (!def) {
			return {
				ok: false,
				content: `Неизвестный subagent_type "${type}". Используй explore или general.`
			};
		}

		if (!ext.runSubagent) {
			return {
				ok: false,
				content: 'Запуск субагента недоступен'
			};
		}

		const denied = await confirmAlwaysOrSkip(ctx, `Задача -> ${def.name}`, prompt.slice(0, 400));
		if (denied) {
			return denied;
		}

		try {
			const report = await ext.runSubagent({
				type: def.id,
				prompt: `${def.prompt}\n\n# Задание\n${prompt}`,
				signal: ctx.signal ?? new AbortController().signal,
			});
			return {
				ok: true,
				content: JSON.stringify({
					subagent: def.id,
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
	description: 'Дождаться фонового job от run_command (background=true) или проверить статус по job_id.',
	parameters: {
		type: 'object',
		properties: {
			job_id: {
				type: 'string'
			},
			timeout_ms: {
				type: 'integer',
				description: 'Сколько ждать завершения (по умолчанию 60000)'
			},
		},
		required: ['job_id'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const shell = (ctx as ToolContext & { shell?: import('../shellSession').ShellSession }).shell;
		if (!shell) {
			return {
				ok: false,
				content: 'Shell-сессия недоступна'
			};
		}
		
		const jobId = asString(args, 'job_id').trim();
		const job = shell.getJob(jobId);
		if (!job) {
			return {
				ok: false,
				content: `Неизвестный job_id: ${jobId}`
			};
		}

		const timeoutMs = Math.min(300_000, Math.max(1000, Number(args.timeout_ms) || 60_000));
		const deadline = Date.now() + timeoutMs;
		while (!job.done && Date.now() < deadline) {
			throwIfAborted(ctx.signal);
			await new Promise((r) => setTimeout(r, 200));
		}
		
		return {
			ok: job.done ? (job.exitCode === 0) : true,
			content: shell.formatJob(job) + (job.done ? '' : '\n(статус: ещё выполняется / таймаут ожидания)'),
		};
	},
};
