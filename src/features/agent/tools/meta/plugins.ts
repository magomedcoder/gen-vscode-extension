import { discoverLocalPlugins } from '../../../project/plugins';
import { asString } from '../../types';
import type { ToolContext, ToolDefinition, ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';

// Список локальных `.gen/tools` и `.gen/plugins` (без npm, без JS)
export const listPluginsTool: ToolDefinition = {
	name: 'list_plugins',
	description: 'Список локальных plugins/tools из `.gen/plugins` и `.gen/tools` (только манифесты/описания).',
	parameters: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	async execute(_args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const items = await discoverLocalPlugins();
		return {
			ok: true,
			content: JSON.stringify({
				count: items.length,
				items: items.map((item) => ({
					kind: item.kind,
					name: item.name,
					description: item.description,
					path: item.path,
					hasBody: Boolean(item.body.trim()),
				})),
			}, null, 2),
		};
	},
};

// Загрузить инструкции локального plugin/tool по имени в контекст
export const pluginTool: ToolDefinition = {
	name: 'plugin',
	description: 'Загрузить описание локального plugin/tool по имени (из `.gen/plugins` / `.gen/tools`). JS не исполняется.',
	parameters: {
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description: 'Имя plugin или tool',
			},
		},
		required: ['name'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const name = asString(args, 'name').trim().toLowerCase();
		if (!name) {
			return {
				ok: false,
				content: 'plugin: нужен параметр name',
			};
		}

		const items = await discoverLocalPlugins();
		const hit = items.find((item) => item.name.toLowerCase() === name);
		if (!hit) {
			return {
				ok: false,
				content: `Неизвестный plugin/tool "${name}". Доступны: ${items.map((i) => i.name).join(', ') || '(нет)'}`,
			};
		}

		const kindLabel = hit.kind === 'tool' ? 'Tool' : 'Plugin';
		const body = hit.body.trim() || '(пустое тело - только манифест; открой соседний PLUGIN.md / TOOL.md через read_file)';
		return {
			ok: true,
			content: `# ${kindLabel}: ${hit.name}\nПуть: ${hit.path}\nОписание: ${hit.description}\n\n${body}`,
		};
	},
};
