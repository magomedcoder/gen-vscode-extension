import { formatPlan, parsePlanArgs } from '../plan';
import type { StickyPlan, StickyPlanSnapshot} from '../plan';
import { asObjectArray, asString } from '../types';
import type { ToolContext, ToolDefinition, ToolResult } from '../types';
import { throwIfAborted } from '../workspacePath';
import { confirmAlwaysOrSkip } from './confirm';

export const proposePlanTool: ToolDefinition = {
	name: 'propose_plan',
	description: 'Показать план правок (несколько файлов) и дождаться Approve. План сохраняется в `.gen/plan.md` и сессии на следующие ходы. Вызывать до write/patch/delete, если задача затрагивает больше одного файла или нужна составная цель.',
	parameters: {
		type: 'object',
		properties: {
			title: {
				type: 'string',
				description: 'Краткий заголовок плана',
			},
			steps: {
				type: 'array',
				description: 'Шаги плана',
				items: {
					type: 'object',
					properties: {
						title: {
							type: 'string',
							description: 'Что сделать',
						},
						path: {
							type: 'string',
							description: 'Путь к файлу',
						},
						action: {
							type: 'string',
							description: 'write / patch / delete / create_dir / test',
						},
					},
					required: ['title'],
				},
			},
		},
		required: ['title', 'steps'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const plan = parsePlanArgs(args);
		const formatted = formatPlan(plan);
		const denied = await confirmAlwaysOrSkip(ctx, `Выполнить план: ${plan.title}?`, formatted);
		if (denied) {
			return {
				...denied,
				content: denied.content === 'Пользователь отклонил действие' ? `План отклонён:\n${formatted}` : denied.content,
			};
		}

		ctx.plan?.approve(plan);
		ctx.onPlanChanged?.();
		return {
			ok: true,
			content: `План подтверждён и сохранён в сессии. Следуй шагам на следующих ходах; отмечай прогресс через update_plan.\n${formatted}`,
		};
	},
};

function asStatus(raw: string): 'pending' | 'in_progress' | 'done' | 'skipped' | undefined {
	const v = raw.trim().toLowerCase();
	if (v === 'pending' || v === 'in_progress' || v === 'done' || v === 'skipped') {
		return v;
	}

	return undefined;
}

function formatStickyPlanBrief(snap: StickyPlanSnapshot): string {
	return [
		`«${snap.title}»`,
		...snap.steps.map(
			(s, i) => `${i + 1}. [${s.status}] ${s.title}${s.path ? ` (${s.path})` : ''}`,
		),
	].join('\n');
}

export const updatePlanTool: ToolDefinition = {
	name: 'update_plan',
	description: 'Обновить прогресс активного плана сессии (статусы шагов), заменить шаги или очистить план. Вызывай после выполнения шага и когда пользователь меняет задачу.',
	parameters: {
		type: 'object',
		properties: {
			clear: {
				type: 'boolean',
				description: 'Сбросить активный план сессии',
			},
			steps: {
				type: 'array',
				description: 'Обновить статусы шагов по номеру (1-based)',
				items: {
					type: 'object',
					properties: {
						index: { 
							type: 'number', 
							description: 'Номер шага с 1'
						},
						status: {
							type: 'string',
							description: 'pending | in_progress | done | skipped',
						},
					},
					required: ['index', 'status'],
				},
			},
			replace: {
				type: 'object',
				description: 'Заменить весь план (с подтверждением пользователя)',
				properties: {
					title: { type: 'string' },
					steps: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								title: { type: 'string' },
								path: { type: 'string' },
								action: { type: 'string' },
							},
							required: ['title'],
						},
					},
				},
				required: ['title', 'steps'],
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const plan = ctx.plan as StickyPlan | undefined;
		if (!plan) {
			return { ok: false, content: 'План сессии недоступен' };
		}

		if (args.clear === true) {
			plan.clear();
			ctx.onPlanChanged?.();
			return { ok: true, content: 'План сессии очищен.' };
		}

		if (args.replace && typeof args.replace === 'object' && !Array.isArray(args.replace)) {
			const next = parsePlanArgs(args.replace as Record<string, unknown>);
			const formatted = formatPlan(next);
			const denied = await confirmAlwaysOrSkip(ctx, `Заменить план: ${next.title}?`, formatted);
			if (denied) {
				return denied;
			}

			plan.replaceSteps(next, false);
			ctx.onPlanChanged?.();
			return {
				ok: true,
				content: `План заменён.\n${formatted}`,
			};
		}

		const updates = asObjectArray(args, 'steps');
		if (updates.length === 0) {
			return {
				ok: false,
				content: 'Укажи steps (index+status), replace или clear',
			};
		}

		if (!plan.hasPlan || !plan.isApproved) {
			return {
				ok: false,
				content: 'Нет активного плана. Сначала propose_plan.',
			};
		}

		for (const item of updates) {
			const index = Number(item.index);
			const status = asStatus(asString(item, 'status'));
			if (!Number.isFinite(index) || !status) {
				return {
					ok: false,
					content: 'Каждый step нужен с index (число) и status (pending|in_progress|done|skipped)',
				};
			}
			plan.setStepStatus(Math.floor(index), status);
		}

		ctx.onPlanChanged?.();
		const snap = plan.snapshot();
		return {
			ok: true,
			content: snap ? `План обновлён.\n${formatStickyPlanBrief(snap)}` : 'План обновлён.',
		};
	},
};
