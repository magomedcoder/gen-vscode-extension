import * as vscode from 'vscode';

const PERSONAS_GLOB = '.gen/personas/*.md';
const MAX_BODY_CHARS = 8_000;

export interface PersonaInfo {
	id: string;
	name: string;
	description: string;
	body: string;
	path: string;
}

function parseFrontmatter(raw: string): {
	name?: string;
	description?: string;
	body: string;
} {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw.trim());
	if (!match) {
		return { 
			body: raw.trim() 
		};
	}

	const meta = match[1]!;
	const body = match[2]!.trim();
	const name = /^\s*name:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	const description = /^\s*description:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	return { 
		name, 
		description, 
		body 
	};
}

function slugify(name: string): string {
	return name.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9_-]/g, '')
		.slice(0, 48) || 'persona';
}

// Найти персоны в `.gen/personas/*.md` (frontmatter name/description)
export async function discoverPersonas(): Promise<PersonaInfo[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, PERSONAS_GLOB), undefined, 40);
	const out: PersonaInfo[] = [];
	const seen = new Set<string>();

	for (const uri of uris) {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const raw = new TextDecoder().decode(bytes);
			const parsed = parseFrontmatter(raw);
			const fileBase = (uri.path.split('/').pop() ?? 'persona').replace(/\.md$/i, '');
			const name = (parsed.name || fileBase).trim();
			const id = slugify(name);
			if (seen.has(id)) {
				continue;
			}

			seen.add(id);
			const body = parsed.body.length > MAX_BODY_CHARS
				? `${parsed.body.slice(0, MAX_BODY_CHARS)}\n\n[truncated]`
				: parsed.body;
			out.push({
				id,
				name,
				description: parsed.description || name,
				body,
				path: vscode.workspace.asRelativePath(uri),
			});
		} catch {
			continue;
		}
	}

	return out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export async function resolvePersona(personaId: string): Promise<PersonaInfo | undefined> {
	const id = personaId.trim().toLowerCase();
	if (!id) {
		return undefined;
	}

	const list = await discoverPersonas();
	return list.find((p) => p.id === id || p.name.toLowerCase() === id);
}

// Фрагмент для system prompt
export function formatPersonaAppendix(persona: PersonaInfo): string {
	const lines = [
		`## Персона: ${persona.name}`,
		persona.description ? `Описание: ${persona.description}` : '',
		persona.body || '',
	].filter(Boolean);
	return lines.join('\n');
}
