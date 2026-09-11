import type { ChatMode } from '../../../../core/config/types';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';
import { confirmAlwaysOrSkip } from '../confirm';

export interface NewTaskToolContext extends ToolContext {
	createNewTask?(params: {
		title?: string;
		prompt: string;
		mode?: ChatMode;
		autoStart?: boolean;
	}): Promise<{ sessionId: string; title: string }>;
}

export const newTaskTool: ToolDefinition = {
	name: 'new_task',
	description: 'Создать новую вкладку чата с заданием (handoff после research). Опционально сразу запустить ход. Не заменяет текущую сессию.',
	parameters: {
		type: 'object',
		properties: {
			prompt: {
				type: 'string',
				description: 'Текст первого сообщения / задания для новой сессии',
			},
			title: {
				type: 'string',
				description: 'Заголовок вкладки (опционально)',
			},
			mode: {
				type: 'string',
				enum: ['agent', 'plan', 'ask', 'debug', 'design', 'multitask', 'project'],
				description: 'Режим новой сессии (по умолчанию agent)',
			},
			auto_start: {
				type: 'boolean',
				description: 'Сразу отправить prompt в новую сессию (по умолчанию true)',
			},
		},
		required: ['prompt'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const ext = ctx as NewTaskToolContext;
		const prompt = asString(args, 'prompt').trim();
		if (!prompt) {
			return { 
				ok: false,
				content: 'new_task: нужен prompt'
			};
		}

		if (!ext.createNewTask) {
			return {
				ok: false,
				content: 'Создание новой задачи недоступно'
			};
		}

		const title = asString(args, 'title').trim() || undefined;
		const modeRaw = asString(args, 'mode', 'agent').trim().toLowerCase();
		const allowed: ChatMode[] = ['agent', 'plan', 'ask', 'debug', 'design', 'multitask', 'project'];
		const mode = (allowed.includes(modeRaw as ChatMode) ? modeRaw : 'agent') as ChatMode;
		const autoStart = args.auto_start !== false;

		const denied = await confirmAlwaysOrSkip(ctx, `Новая задача${title ? `: ${title}` : ''}`, prompt.slice(0, 400));
		if (denied) {
			return denied;
		}

		try {
			const created = await ext.createNewTask({
				title,
				prompt,
				mode,
				autoStart,
			});
			return {
				ok: true,
				content: JSON.stringify(
					{
						sessionId: created.sessionId,
						title: created.title,
						mode,
						autoStart,
						note: 'Новая вкладка создана. Продолжай в текущей сессии или переключись на новую.',
					},
					null,
					2,
				),
			};
		} catch (err) {
			return {
				ok: false,
				content: err instanceof Error ? err.message : String(err),
			};
		}
	},
};
