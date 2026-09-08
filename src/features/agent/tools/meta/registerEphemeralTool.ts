import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { getToolByName, getToolSource, registerTool, sanitizeEphemeralToolName } from '../registry';

const EPHEMERAL_META = {
	tags: ['meta'] as const,
	risk: 'read' as const,
};

/**
 * Зарегистрировать временный markdown-tool на текущий run (без JS).
 * Сбрасывается через unregisterEphemeralTools() в конце AgentSession turn.
 */
export const registerEphemeralToolTool: ToolDefinition = {
	name: 'register_ephemeral_tool',
	description: 'Зарегистрировать временный tool на этот run: имя, описание и markdown-тело (без JS). После хода агента tool снимается.',
	parameters: {
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description: 'Имя tool ([a-z0-9_-])',
			},
			description: {
				type: 'string',
				description: 'Краткое описание для LLM',
			},
			body: {
				type: 'string',
				description: 'Markdown/текст, который вернёт tool при вызове (не исполняется)',
			},
		},
		required: ['name', 'description', 'body'],
		additionalProperties: false,
	},
	async execute(args, _ctx: ToolContext): Promise<ToolResult> {
		const preferred = sanitizeEphemeralToolName(asString(args, 'name'));
		const description = asString(args, 'description').trim().slice(0, 300) || preferred;
		const body = asString(args, 'body').trim() || '(пустое описание)';

		const existing = getToolByName(preferred);
		const source = getToolSource(preferred);
		if (existing && source !== 'ephemeral') {
			return {
				ok: false,
				content: `register_ephemeral_tool: имя «${preferred}» занято (${source ?? 'unknown'})`,
			};
		}

		const tool: ToolDefinition = {
			name: preferred,
			description: `${description} [ephemeral; no JS]`.slice(0, 300),
			parameters: {
				type: 'object',
				properties: {},
				additionalProperties: false,
			},
			async execute(): Promise<ToolResult> {
				return {
					ok: true,
					content: [`# Ephemeral tool: ${preferred}`, '', body].join('\n'),
				};
			},
		};

		registerTool(tool, { tags: [...EPHEMERAL_META.tags], risk: EPHEMERAL_META.risk }, 'ephemeral');
		return {
			ok: true,
			content: JSON.stringify(
				{
					registered: preferred,
					hint: 'Tool доступен до конца текущего хода; JS не исполняется',
				},
				null,
				2,
			),
		};
	},
};
