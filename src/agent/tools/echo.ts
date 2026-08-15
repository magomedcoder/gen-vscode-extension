import type { ToolContext, ToolDefinition, ToolResult } from '../types';

export const echoTool: ToolDefinition = {
	name: 'echo',
	description: 'Эхо: возвращает переданную строку. Демонстрационный tool для проверки agent loop.',
	parameters: {
		type: 'object',
		properties: {
			text: {
				type: 'string',
				description: 'Текст, который нужно вернуть без изменений',
			},
		},
		required: ['text'],
		additionalProperties: false,
	},
	async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
		const text = typeof args.text === 'string' ? args.text : String(args.text ?? '');
		return {
			ok: true,
			content: text,
		};
	},
};
