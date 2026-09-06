import type { ChatMode } from '../../../core/config/types';
import type { ToolDefinition } from '../types';

export type ToolTag = 'fs' | 'search' | 'shell' | 'ide' | 'mcp' | 'plan' | 'meta';

// Риск для approval / фильтров (этап 2; permissionPolicy пока по имени)
export type ToolRisk = 'read' | 'write' | 'shell' | 'web' | 'mcp';

export type ToolSource = 'builtin' | 'dynamic';

export interface ToolMeta {
	tags: ToolTag[];
	risk: ToolRisk;
	modes?: ChatMode[];
	timeoutMs?: number;
}

interface RegistryEntry {
	tool: ToolDefinition;
	meta?: ToolMeta;
	source: ToolSource;
}

const BY_NAME = new Map<string, RegistryEntry>();

/**
 * Регистрация builtin или dynamic tool.
 * Dynamic с тем же именем заменяет предыдущий dynamic; builtin не перекрывается.
 */
export function registerTool(
	tool: ToolDefinition,
	meta?: ToolMeta,
	source: ToolSource = 'builtin',
): void {
	const existing = BY_NAME.get(tool.name);
	if (existing && existing.tool !== tool) {
		if (!(source === 'dynamic' && existing.source === 'dynamic')) {
			throw new Error(`Tool already registered: ${tool.name}`);
		}
	}

	BY_NAME.set(tool.name, {
		tool,
		meta: meta ?? existing?.meta,
		source,
	});
}

export function getToolByName(name: string): ToolDefinition | undefined {
	return BY_NAME.get(name)?.tool;
}

export function getToolMeta(name: string): ToolMeta | undefined {
	return BY_NAME.get(name)?.meta;
}

export function getToolSource(name: string): ToolSource | undefined {
	return BY_NAME.get(name)?.source;
}

// Снимок зарегистрированных tools (порядок вставки)
export function listTools(): ToolDefinition[] {
	return [...BY_NAME.values()].map((e) => e.tool);
}

export function listToolsByTag(tag: ToolTag): ToolDefinition[] {
	return [...BY_NAME.values()].filter((e) => e.meta?.tags.includes(tag))
		.map((e) => e.tool);
}

// Снять все dynamic (перед refresh `.gen/tools`)
export function unregisterDynamicTools(): void {
	for (const [name, entry] of [...BY_NAME.entries()]) {
		if (entry.source === 'dynamic') {
			BY_NAME.delete(name);
		}
	}
}

// Только для unit-тестов
export function clearToolsForTests(): void {
	BY_NAME.clear();
}
