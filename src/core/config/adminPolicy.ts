import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { GenSettings } from './types';
import { DEFAULT_SETTINGS } from './types';

/**
 * Managed / admin policy layer (MDM-паттерн, без полного Enterprise).
 *
 * Путь к policy.json (первый существующий):
 * 1. `GEN_ADMIN_POLICY` - явный путь к файлу
 * 2. Linux/macOS: `/etc/gen/policy.json`
 * 3. Windows: `%ProgramData%/gen/policy.json`
 *
 * Ключи из файла принудительно перекрывают user / UI / project.
 * Опционально `mcpServersAllowlist` - фильтр имён MCP после merge.
 */

// Ключи GenSettings, которые admin policy может заблокировать / форсировать
export const ADMIN_POLICY_KEYS = [
	'approvalPolicy',
	'autoApprove',
	'continueLoopOnDeny',
	'enableTerminal',
	'enableFileReading',
	'enableWorkspaceContext',
	'webSearchEnabled',
	'webFetchEnabled',
	'allowExternalDirectory',
	'otelEnabled',
	'otelEndpoint',
	'mcpServers',
	'providerUsePolicy',
	'providerUsePatterns',
] as const satisfies readonly (keyof GenSettings)[];

export type AdminPolicyKey = (typeof ADMIN_POLICY_KEYS)[number];

const ADMIN_POLICY_KEY_SET = new Set<string>(ADMIN_POLICY_KEYS);

const META_KEYS = new Set(['$schema', 'version', 'description', 'mcpServersAllowlist']);

export interface AdminPolicySnapshot {
	// Файл найден и распарсен (даже если lockedKeys пуст - policy «пустой»)
	active: boolean;
	// Абсолютный путь к загруженному файлу
	path?: string;
	// Overlay GenSettings (только ADMIN_POLICY_KEYS)
	settings: Partial<GenSettings>;
	// Паттерны allowlist имён MCP (если заданы в policy)
	mcpServersAllowlist?: string[];
	// Имена заблокированных ключей (+ mcpServersAllowlist при наличии)
	lockedKeys: string[];
}

const EMPTY: AdminPolicySnapshot = {
	active: false,
	settings: {},
	lockedKeys: [],
};

let snapshot: AdminPolicySnapshot = EMPTY;

/**
 * Кандидаты пути к admin policy (порядок приоритета).
 * Если задан `GEN_ADMIN_POLICY` - только он (даже если файла нет * нет политики).
 */
export function resolveAdminPolicyCandidates(): string[] {
	const envPath = process.env.GEN_ADMIN_POLICY?.trim();
	if (envPath) {
		return [path.resolve(envPath)];
	}

	if (process.platform === 'win32') {
		// Обычно ProgramData = C:\ProgramData
		const programData = process.env.PROGRAMDATA?.trim() || 'C:\\ProgramData';
		return [path.join(programData, 'gen', 'policy.json')];
	}

	return [path.join('/etc', 'gen', 'policy.json')];
}

// Простой glob-like match для имён MCP (`*`, prefix*, *suffix)
export function matchAdminPattern(pattern: string, subject: string): boolean {
	const p = pattern.trim();
	const s = subject.trim();
	if (!p) {
		return false;
	}

	if (p === '*' || p === s) {
		return true;
	}

	if (p.endsWith('*') && p.startsWith('*') && p.length > 1) {
		return s.includes(p.slice(1, -1));
	}

	if (p.endsWith('*')) {
		return s.startsWith(p.slice(0, -1));
	}

	if (p.startsWith('*')) {
		return s.endsWith(p.slice(1));
	}

	return s === p;
}

export function parseAdminPolicy(raw: unknown): {
	settings: Partial<GenSettings>;
	mcpServersAllowlist?: string[];
	lockedKeys: string[];
} {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {
			settings: {},
			lockedKeys: []
		};
	}

	const obj = raw as Record<string, unknown>;
	const settings: Partial<GenSettings> = {};
	const lockedKeys: string[] = [];

	for (const [key, value] of Object.entries(obj)) {
		if (META_KEYS.has(key) || value === undefined) {
			continue;
		}

		if (!ADMIN_POLICY_KEY_SET.has(key)) {
			continue;
		}
		
		(settings as Record<string, unknown>)[key] = value;
		lockedKeys.push(key);
	}

	let mcpServersAllowlist: string[] | undefined;
	const allowRaw = obj.mcpServersAllowlist;
	if (Array.isArray(allowRaw)) {
		mcpServersAllowlist = allowRaw.map((item) => String(item).trim())
			.filter(Boolean)
			.slice(0, 80);
		if (mcpServersAllowlist.length > 0) {
			lockedKeys.push('mcpServersAllowlist');
		} else {
			mcpServersAllowlist = undefined;
		}
	}

	lockedKeys.sort();
	return {
		settings,
		mcpServersAllowlist,
		lockedKeys
	};
}

async function readJsonFile(filePath: string): Promise<unknown | undefined> {
	try {
		const text = await fs.readFile(filePath, 'utf8');
		const trimmed = text.trim();
		if (!trimmed) {
			return undefined;
		}

		return JSON.parse(trimmed) as unknown;
	} catch {
		return undefined;
	}
}

export function getAdminPolicySnapshot(): AdminPolicySnapshot {
	return snapshot;
}

// Есть ли активная admin policy с хотя бы одним locked-ключом
export function isAdminPolicyActive(): boolean {
	return snapshot.active && snapshot.lockedKeys.length > 0;
}

/**
 * Применить admin overlay к уже смерженным settings (после user/UI/project).
 * Также фильтрует mcpServers по allowlist.
 */
export function applyAdminPolicy(merged: Partial<GenSettings>): Partial<GenSettings> {
	if (!snapshot.active || snapshot.lockedKeys.length === 0) {
		return merged;
	}

	const out: Partial<GenSettings> = { 
		...merged, 
		...snapshot.settings
	};

	const allow = snapshot.mcpServersAllowlist;
	if (allow && allow.length > 0) {
		const servers = Array.isArray(out.mcpServers) ? out.mcpServers : [];
		out.mcpServers = servers.filter((s) =>
			allow.some((pat) => matchAdminPattern(pat, s.name)),
		);
	}

	return out;
}

// Перед записью в UI globalState: locked-ключи сбрасываем к defaults, чтобы после снятия политики в store не остались «зашитые» значения
export function stripAdminLockedForStorage(settings: GenSettings): GenSettings {
	if (!snapshot.active || snapshot.lockedKeys.length === 0) {
		return settings;
	}

	const out = { ...settings };
	for (const key of ADMIN_POLICY_KEYS) {
		if (!snapshot.lockedKeys.includes(key)) {
			continue;
		}

		const def = DEFAULT_SETTINGS[key];
		(out as Record<string, unknown>)[key] = Array.isArray(def)
			? [...def]
			: typeof def === 'object' && def !== null
				? structuredClone(def)
				: def;
	}

	return out;
}

// Перечитать admin policy с диска
export async function reloadAdminPolicy(): Promise<AdminPolicySnapshot> {
	const candidates = resolveAdminPolicyCandidates();
	const envForced = Boolean(process.env.GEN_ADMIN_POLICY?.trim());

	for (const candidate of candidates) {
		const raw = await readJsonFile(candidate);
		if (raw === undefined) {
			if (envForced) {
				// Явный путь задан, но файла нет - политики нет
				snapshot = EMPTY;
				return snapshot;
			}
			continue;
		}

		const parsed = parseAdminPolicy(raw);
		snapshot = {
			active: true,
			path: candidate,
			settings: parsed.settings,
			mcpServersAllowlist: parsed.mcpServersAllowlist,
			lockedKeys: parsed.lockedKeys,
		};
		return snapshot;
	}

	snapshot = EMPTY;
	return snapshot;
}

// Сброс кэша (тесты)
export function resetAdminPolicyForTests(): void {
	snapshot = EMPTY;
}
