import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExternalHookKind } from '../chat/protocol';

export type { ExternalHookKind };

export interface ExternalHookCandidate {
	kind: ExternalHookKind;
	// Абсолютный путь к файлу
	path: string;
}

export interface ExternalHookFileInfo extends ExternalHookCandidate {
	exists: boolean;
	// Сколько shell-команд удалось сопоставить с Gen-событиями
	mappedCommandCount: number;
	// Внешние события без очевидного Gen-аналога
	skippedEvents: string[];
	// Ошибка чтения/разбора (файл есть, но битый)
	error?: string;
}

export interface GenHooksLists {
	beforeSubmit: string[];
	beforeShell: string[];
	sessionDiff: string[];
	sessionCompacting: string[];
	shellEnv: string[];
	fileWatcher: string[];
}

export interface ExternalHooksImportResult {
	mapped: GenHooksLists;
	// События, которые не смаппились (для UI / заметки)
	skippedEvents: string[];
	// Сколько команд попало в mapped
	mappedCommandCount: number;
}

// Формат hooks.json -> Gen (очевидные соответствия)
const HOOKS_JSON_EVENT_MAP: Record<string, keyof GenHooksLists> = {
	beforeSubmitPrompt: 'beforeSubmit',
	beforeShellExecution: 'beforeShell',
	preCompact: 'sessionCompacting',
	afterFileEdit: 'sessionDiff',
	beforeSubmit: 'beforeSubmit',
	beforeShell: 'beforeShell',
	'session.diff': 'sessionDiff',
	sessionDiff: 'sessionDiff',
	'session.compacting': 'sessionCompacting',
	sessionCompacting: 'sessionCompacting',
	'shell.env': 'shellEnv',
	shellEnv: 'shellEnv',
	'file.watcher': 'fileWatcher',
	fileWatcher: 'fileWatcher',
};

// Формат settings.json hooks -> Gen
const SETTINGS_JSON_EVENT_MAP: Record<string, keyof GenHooksLists> = {
	UserPromptSubmit: 'beforeSubmit',
	PreCompact: 'sessionCompacting',
	beforeSubmit: 'beforeSubmit',
	beforeShell: 'beforeShell',
	'session.diff': 'sessionDiff',
	sessionDiff: 'sessionDiff',
	'session.compacting': 'sessionCompacting',
	sessionCompacting: 'sessionCompacting',
	'shell.env': 'shellEnv',
	shellEnv: 'shellEnv',
	'file.watcher': 'fileWatcher',
	fileWatcher: 'fileWatcher',
};

function emptyLists(): GenHooksLists {
	return {
		beforeSubmit: [],
		beforeShell: [],
		sessionDiff: [],
		sessionCompacting: [],
		shellEnv: [],
		fileWatcher: [],
	};
}

function pushUnique(list: string[], command: string): void {
	const trimmed = command.trim();
	if (!trimmed || list.includes(trimmed)) {
		return;
	}

	list.push(trimmed);
}

function countCommands(lists: GenHooksLists): number {
	return lists.beforeSubmit.length
		+ lists.beforeShell.length
		+ lists.sessionDiff.length
		+ lists.sessionCompacting.length
		+ lists.shellEnv.length
		+ lists.fileWatcher.length;
}

// Кандидаты путей: user + project compat layouts (без чтения)
export function listExternalHookCandidates(
	workspaceRoot?: string,
	homedir: string = os.homedir(),
): ExternalHookCandidate[] {
	const out: ExternalHookCandidate[] = [
		{
			kind: 'hooks-json-user',
			path: path.join(homedir, '.cursor', 'hooks.json'),
		},
		{
			kind: 'settings-json-user',
			path: path.join(homedir, '.claude', 'settings.json'),
		},
	];

	const root = workspaceRoot?.trim();
	if (root) {
		out.push(
			{
				kind: 'hooks-json-project',
				path: path.join(root, '.cursor', 'hooks.json'),
			},
			{
				kind: 'settings-json-project',
				path: path.join(root, '.claude', 'settings.json'),
			},
		);
	}

	return out;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function readJsonFile(filePath: string): Promise<unknown> {
	const text = await fs.readFile(filePath, 'utf8');
	return JSON.parse(text) as unknown;
}

// Извлечь shell-команды из массива hook entries (hooks.json)
function extractHooksJsonCommands(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}

	const out: string[] = [];
	for (const item of raw) {
		if (typeof item === 'string' && item.trim()) {
			out.push(item.trim());
			continue;
		}

		if (item && typeof item === 'object') {
			const cmd = (item as { command?: unknown }).command;
			if (typeof cmd === 'string' && cmd.trim()) {
				out.push(cmd.trim());
			}
		}
	}

	return out;
}

/**
 * settings.json: hooks[Event] = [{ matcher?, hooks: [{ type, command }] }]
 * Best-effort: также плоский { command } / строка.
 */
function extractSettingsJsonCommands(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: string[] = [];
	for (const group of raw) {
		if (typeof group === 'string' && group.trim()) {
			out.push(group.trim());
			continue;
		}

		if (!group || typeof group !== 'object') {
			continue;
		}

		const obj = group as {
			command?: unknown;
			hooks?: unknown;
			type?: unknown;
		};
		if (typeof obj.command === 'string' && obj.command.trim()) {
			if (!obj.type || obj.type === 'command') {
				out.push(obj.command.trim());
			}
		}

		if (!Array.isArray(obj.hooks)) {
			continue;
		}

		for (const handler of obj.hooks) {
			if (typeof handler === 'string' && handler.trim()) {
				out.push(handler.trim());
				continue;
			}

			if (!handler || typeof handler !== 'object') {
				continue;
			}

			const h = handler as { type?: unknown; command?: unknown };
			if (h.type && h.type !== 'command') {
				continue;
			}

			if (typeof h.command === 'string' && h.command.trim()) {
				out.push(h.command.trim());
			}
		}
	}

	return out;
}

// Matcher PreToolUse похож на Bash/Shell * beforeShell
function settingsMatcherIsShell(matcher: unknown): boolean {
	if (matcher === undefined || matcher === null) {
		return true;
	}

	const m = String(matcher).trim();
	if (!m || m === '*') {
		return true;
	}

	return /\b(bash|shell)\b/i.test(m);
}

// Matcher PostToolUse похож на Write/Edit * session.diff
function settingsMatcherIsFileEdit(matcher: unknown): boolean {
	if (matcher === undefined || matcher === null) {
		return false;
	}

	const m = String(matcher).trim();
	if (!m || m === '*') {
		return true;
	}

	return /\b(write|edit|multiedit|notebookedit)\b/i.test(m);
}

function extractSettingsGroupedCommands(
	raw: unknown,
	matcherOk: (matcher: unknown) => boolean,
): {
	commands: string[];
	anyGroup: boolean;
	matchedGroup: boolean;
} {
	if (!Array.isArray(raw)) {
		return {
			commands: [],
			anyGroup: false,
			matchedGroup: false,
		};
	}
	const commands: string[] = [];
	let anyGroup = false;
	let matchedGroup = false;
	for (const group of raw) {
		anyGroup = true;
		if (!group || typeof group !== 'object') {
			continue;
		}

		const obj = group as {
			matcher?: unknown;
			hooks?: unknown;
			command?: unknown;
			type?: unknown;
		};
		if (!matcherOk(obj.matcher)) {
			continue;
		}

		matchedGroup = true;
		for (const cmd of extractSettingsJsonCommands([obj])) {
			pushUnique(commands, cmd);
		}
	}

	return { commands, anyGroup, matchedGroup };
}

function asHooksObject(raw: unknown): Record<string, unknown> | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}

	const obj = raw as { hooks?: unknown };
	if (obj.hooks && typeof obj.hooks === 'object' && !Array.isArray(obj.hooks)) {
		return obj.hooks as Record<string, unknown>;
	}

	// Иногда события лежат на верхнем уровне без обёртки hooks
	return obj as Record<string, unknown>;
}

// Разобрать hooks.json -> Gen-списки + skipped
export function parseHooksJsonFile(raw: unknown): ExternalHooksImportResult {
	const hooks = asHooksObject(raw) ?? {};
	const mapped = emptyLists();
	const skippedEvents: string[] = [];

	for (const [event, value] of Object.entries(hooks)) {
		if (event === 'version') {
			continue;
		}
		const target = HOOKS_JSON_EVENT_MAP[event];
		const commands = extractHooksJsonCommands(value);
		if (!target) {
			if (commands.length > 0 || (Array.isArray(value) && value.length > 0)) {
				skippedEvents.push(event);
			}
			continue;
		}

		for (const cmd of commands) {
			pushUnique(mapped[target], cmd);
		}
	}

	return {
		mapped,
		skippedEvents: [...new Set(skippedEvents)].sort(),
		mappedCommandCount: countCommands(mapped),
	};
}

// Best-effort разбор settings.json hooks -> Gen-списки + skipped
export function parseSettingsJsonHooks(raw: unknown): ExternalHooksImportResult {
	const hooks = asHooksObject(raw) ?? {};
	const mapped = emptyLists();
	const skippedEvents: string[] = [];

	for (const [event, value] of Object.entries(hooks)) {
		if (event === 'PreToolUse') {
			const { commands, anyGroup, matchedGroup } = extractSettingsGroupedCommands(
				value,
				settingsMatcherIsShell,
			);

			for (const cmd of commands) {
				pushUnique(mapped.beforeShell, cmd);
			}

			if (anyGroup && !matchedGroup) {
				skippedEvents.push('PreToolUse (non-Bash/Shell matcher)');
			} else if (anyGroup && matchedGroup) {
				const allGroups = Array.isArray(value) ? value : [];
				const hasNonShell = allGroups.some((g) => {
					if (!g || typeof g !== 'object') {
						return false;
					}
					return !settingsMatcherIsShell((g as { matcher?: unknown }).matcher);
				});
				if (hasNonShell) {
					skippedEvents.push('PreToolUse (non-Bash/Shell matcher)');
				}
			}
			continue;
		}

		if (event === 'PostToolUse') {
			const { commands, anyGroup, matchedGroup } = extractSettingsGroupedCommands(
				value,
				settingsMatcherIsFileEdit,
			);
			for (const cmd of commands) {
				pushUnique(mapped.sessionDiff, cmd);
			}

			if (anyGroup && !matchedGroup) {
				skippedEvents.push('PostToolUse (non-Write/Edit matcher)');
			} else if (anyGroup && matchedGroup) {
				const allGroups = Array.isArray(value) ? value : [];
				const hasOther = allGroups.some((g) => {
					if (!g || typeof g !== 'object') {
						return false;
					}

					return !settingsMatcherIsFileEdit((g as { matcher?: unknown }).matcher);
				});
				if (hasOther) {
					skippedEvents.push('PostToolUse (non-Write/Edit matcher)');
				}
			}
			continue;
		}

		const target = SETTINGS_JSON_EVENT_MAP[event];
		const commands = extractSettingsJsonCommands(value);
		if (!target) {
			if (commands.length > 0 || (Array.isArray(value) && value.length > 0)) {
				skippedEvents.push(event);
			}
			continue;
		}

		for (const cmd of commands) {
			pushUnique(mapped[target], cmd);
		}
	}

	return {
		mapped,
		skippedEvents: [...new Set(skippedEvents)].sort(),
		mappedCommandCount: countCommands(mapped),
	};
}

export function parseExternalHooksFile(
	kind: ExternalHookKind,
	raw: unknown,
): ExternalHooksImportResult {
	if (kind === 'hooks-json-user' || kind === 'hooks-json-project') {
		return parseHooksJsonFile(raw);
	}

	return parseSettingsJsonHooks(raw);
}

// Слить imported в base (append + dedupe)
export function mergeGenHooksLists(base: GenHooksLists, imported: GenHooksLists): GenHooksLists {
	const out = emptyLists();
	for (const key of Object.keys(out) as Array<keyof GenHooksLists>) {
		for (const cmd of base[key]) {
			pushUnique(out[key], cmd);
		}

		for (const cmd of imported[key]) {
			pushUnique(out[key], cmd);
		}
	}

	return out;
}

/**
 * Обнаружить существующие внешние hook-файлы и кратко разобрать их.
 * Не запускает команды - только чтение/маппинг для UI.
 */
export async function discoverExternalHookFiles(
	workspaceRoot?: string,
	homedir: string = os.homedir(),
): Promise<ExternalHookFileInfo[]> {
	const candidates = listExternalHookCandidates(workspaceRoot, homedir);
	const out: ExternalHookFileInfo[] = [];

	for (const c of candidates) {
		const exists = await fileExists(c.path);
		if (!exists) {
			continue;
		}

		try {
			const raw = await readJsonFile(c.path);
			const parsed = parseExternalHooksFile(c.kind, raw);
			out.push({
				...c,
				exists: true,
				mappedCommandCount: parsed.mappedCommandCount,
				skippedEvents: parsed.skippedEvents,
			});
		} catch (err) {
			out.push({
				...c,
				exists: true,
				mappedCommandCount: 0,
				skippedEvents: [],
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return out;
}

// Workspace root из VS Code (первый folder) или undefined
export function getWorkspaceRootFsPath(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
