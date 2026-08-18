import { formatPlan, parsePlanArgs } from '../plan';
import type { ToolContext, ToolDefinition, ToolResult } from '../types';
import { throwIfAborted } from '../workspacePath';
import { confirmAlwaysOrSkip } from './confirm';

export const proposePlanTool: ToolDefinition = {
	name: 'propose_plan',
	description: 'Показать план правок (несколько файлов) и дождаться Approve. Вызывать до write/patch/delete, если задача затрагивает больше одного файла.',
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
				content: denied.content === 'Пользователь отклонил действие'
					? `План отклонён:\n${formatted}`
					: denied.content,
			};
		}

		ctx.plan?.approve();
		return {
			ok: true,
			content: `План подтверждён. Можно править файлы из шагов.\n${formatted}`,
		};
	},
};
