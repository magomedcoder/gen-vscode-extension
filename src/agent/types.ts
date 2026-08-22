import type { Uri } from 'vscode';
import type { LlmToolDefinition } from '../llm/types';
import type { AgentCheckpoint } from './checkpoint';
import type { StickyPlan } from './plan';
import type { AgentWriteTracker } from './userEdits';

export type ConfirmChoice = 'apply' | 'skip' | 'abort';

export interface ToolContext {
	signal?: AbortSignal;
	confirm?(request: { title: string; detail?: string }): Promise<ConfirmChoice>;
	revealFile?(uri: Uri): Promise<void>;
	trackMutation?(uri: Uri): void;
	plan?: StickyPlan;
	onPlanChanged?(): void;
	checkpoint?: AgentCheckpoint;
	writes?: AgentWriteTracker;
}

export interface ToolResult {
	ok: boolean;
	content: string;
	denied?: boolean;
	path?: string;
	diff?: string;
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export function toLlmToolDefinition(tool: ToolDefinition): LlmToolDefinition {
	return {
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	};
}

export function extractPathFromPartialJson(raw: string): string | undefined {
	const pathMatch = raw.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
	if (pathMatch) {
		try {
			return JSON.parse(`"${pathMatch[1]}"`) as string;
		} catch {
			return pathMatch[1];
		}
	}

	return undefined;
}

export function sanitizeToolArgumentsForApi(raw: string): string {
	const trimmed = raw.trim() || '{}';
	try {
		JSON.parse(trimmed);
		return trimmed;
	} catch {
		const path = extractPathFromPartialJson(trimmed);
		return JSON.stringify({
			error: 'invalid_or_truncated_json',
			...(path ? { path } : {}),
		});
	}
}

function invalidToolArgsMessage(raw: string): string {
	const path = extractPathFromPartialJson(raw);
	const parts = [
		'Аргументы инструмента обрезаны или это невалидный JSON (часто лимит max_tokens или кавычки внутри файла).',
		path ? `Путь: ${path}.` : '',
		'Файл не записан.',
		'Повтори: короткий write_file (заготовка), затем apply_patch небольшими кусками. Не клади большой файл целиком в один write_file.',
		`Длина аргументов: ${raw.length} символов.`,
	];

	return parts.filter(Boolean).join(' ');
}

export function parseToolArguments(raw: string): Record<string, unknown> {
	const trimmed = raw.trim() || '{}';
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}

		return { value: parsed };
	} catch {
		throw new Error(invalidToolArgsMessage(trimmed));
	}
}

export function asString(args: Record<string, unknown>, key: string, fallback = ''): string {
	const value = args[key];
	if (typeof value === 'string') {
		return value;
	}

	if (value === undefined || value === null) {
		return fallback;
	}

	return String(value);
}

export function asOptionalInt(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	if (value === undefined || value === null || value === '') {
		return undefined;
	}

	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) {
		return undefined;
	}

	return Math.floor(n);
}

export function asBoolean(args: Record<string, unknown>, key: string, fallback = false): boolean {
	const value = args[key];
	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'string') {
		return value === 'true' || value === '1';
	}
	
	return fallback;
}

export function asObjectArray(args: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const value = args[key];
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}
