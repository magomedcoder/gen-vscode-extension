import * as vscode from 'vscode';

/**
 * Локальные plugins/tools (MVP, без npm и без выполнения JS).
 *
 * Конвенция:
 * - Tools:
 *   - `.gen/tools/<name>.md` - однофайловое описание (YAML frontmatter: name, description)
 *   - `.gen/tools/<name>/TOOL.md` - пакет в папке
 * - Plugins:
 *   - `.gen/plugins/<name>/plugin.json` - манифест (обязательная точка обнаружения) { "name"?, "description"?, "instructions"? }
 *   - если `instructions` пуст - тело берётся из соседнего `PLUGIN.md`
 *
 * Агент видит каталог в system prompt и может загрузить тело через tool `plugin` или прочитать файл через `read_file`. JS из плагинов не исполняется.
 */

export type LocalPluginKind = 'tool' | 'plugin';

export interface LocalPluginInfo {
	kind: LocalPluginKind;
	name: string;
	description: string;
	// Путь к главному файлу (md или plugin.json) относительно workspace
	path: string;
	body: string;
}

const MAX_BODY_CHARS = 16_000;
const MAX_ITEMS = 60;

const TOOL_GLOBS = [
	'.gen/tools/*.md',
	'.gen/tools/*/TOOL.md',
];

const PLUGIN_GLOB = '.gen/plugins/*/plugin.json';

function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw.trim());
	if (!match) {
		return { body: raw.trim() };
	}

	const meta = match[1]!;
	const body = match[2]!.trim();
	const name = /^\s*name:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	const description = /^\s*description:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	return { name, description, body };
}

function truncateBody(body: string): string {
	if (body.length <= MAX_BODY_CHARS) {
		return body;
	}

	return `${body.slice(0, MAX_BODY_CHARS)}\n\n[truncated]`;
}

function folderNameFromUri(uri: vscode.Uri): string {
	const parts = uri.path.split('/').filter(Boolean);
	return parts[parts.length - 2] ?? 'item';
}

function fileStem(uri: vscode.Uri): string {
	const base = uri.path.split('/').pop() ?? 'item';
	return base.replace(/\.md$/i, '');
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder().decode(bytes);
	} catch {
		return undefined;
	}
}

async function readToolMd(uri: vscode.Uri, seen: Set<string>, out: LocalPluginInfo[]): Promise<void> {
	const raw = await readText(uri);
	if (raw === undefined) {
		return;
	}

	const parsed = parseFrontmatter(raw);
	const isToolFile = /\/TOOL\.md$/i.test(uri.path);
	const name = (parsed.name || (isToolFile ? folderNameFromUri(uri) : fileStem(uri))).trim();
	const key = name.toLowerCase();
	if (!name || seen.has(key)) {
		return;
	}

	seen.add(key);
	out.push({
		kind: 'tool',
		name,
		description: parsed.description || name,
		path: vscode.workspace.asRelativePath(uri),
		body: truncateBody(parsed.body),
	});
}

interface PluginManifest {
	name?: string;
	description?: string;
	instructions?: string;
}

function parsePluginJson(raw: string): PluginManifest | undefined {
	try {
		const data = JSON.parse(raw) as unknown;
		if (!data || typeof data !== 'object' || Array.isArray(data)) {
			return undefined;
		}

		const obj = data as Record<string, unknown>;
		return {
			name: typeof obj.name === 'string' ? obj.name.trim() : undefined,
			description: typeof obj.description === 'string' ? obj.description.trim() : undefined,
			instructions: typeof obj.instructions === 'string' ? obj.instructions : undefined,
		};
	} catch {
		return undefined;
	}
}

async function readPluginJson(uri: vscode.Uri, seen: Set<string>, out: LocalPluginInfo[]): Promise<void> {
	const raw = await readText(uri);
	if (raw === undefined) {
		return;
	}

	const manifest = parsePluginJson(raw);
	if (!manifest) {
		return;
	}

	const folder = folderNameFromUri(uri);
	const name = (manifest.name || folder).trim();
	const key = name.toLowerCase();
	if (!name || seen.has(key)) {
		return;
	}

	let body = (manifest.instructions ?? '').trim();
	if (!body) {
		const parts = uri.path.split('/');
		parts[parts.length - 1] = 'PLUGIN.md';
		const pluginMd = uri.with({ path: parts.join('/') });
		const mdRaw = await readText(pluginMd);
		if (mdRaw !== undefined) {
			const parsed = parseFrontmatter(mdRaw);
			body = parsed.body;
			if (!manifest.description && parsed.description) {
				manifest.description = parsed.description;
			}
		}
	}

	seen.add(key);
	out.push({
		kind: 'plugin',
		name,
		description: manifest.description || name,
		path: vscode.workspace.asRelativePath(uri),
		body: truncateBody(body),
	});
}

// Обнаружить локальные tools (`.gen/tools`) и plugins (`.gen/plugins`)
export async function discoverLocalPlugins(): Promise<LocalPluginInfo[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const out: LocalPluginInfo[] = [];
	const seen = new Set<string>();

	for (const glob of TOOL_GLOBS) {
		const uris = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, glob),
			undefined,
			MAX_ITEMS,
		);
		for (const uri of uris) {
			// не подхватывать TOOL.md через `*.md` в корне tools (нет: *.md только один уровень)
			await readToolMd(uri, seen, out);
			if (out.length >= MAX_ITEMS) {
				return out.sort(comparePlugins);
			}
		}
	}

	const pluginUris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, PLUGIN_GLOB),
		undefined,
		MAX_ITEMS,
	);
	for (const uri of pluginUris) {
		await readPluginJson(uri, seen, out);
		if (out.length >= MAX_ITEMS) {
			break;
		}
	}

	return out.sort(comparePlugins);
}

function comparePlugins(a: LocalPluginInfo, b: LocalPluginInfo): number {
	if (a.kind !== b.kind) {
		return a.kind === 'tool' ? -1 : 1;
	}

	return a.name.localeCompare(b.name, 'ru');
}

// Каталог для system prompt (RU)
export function formatPluginsCatalog(items: LocalPluginInfo[]): string | undefined {
	if (items.length === 0) {
		return undefined;
	}

	const lines = items.map((item) => {
		const label = item.kind === 'tool' ? 'tool' : 'plugin';
		return `- [${label}] ${item.name}: ${item.description} (${item.path})`;
	});
	return [
		'Локальные plugins/tools (только описание; JS не исполняется).',
		'Tools из `.gen/tools` также доступны как LLM tools по имени (registry).',
		'Иначе загрузи инструкции через tool plugin по имени или read_file:',
		...lines,
	].join('\n');
}
