import * as vscode from 'vscode';

export interface SkillInfo {
	name: string;
	description: string;
	path: string;
	body: string;
}

const MAX_SKILL_CHARS = 16_000;
const SKILL_GLOBS = [
	'.gen/skills/*/SKILL.md',
	'.claude/skills/*/SKILL.md',
	'.agents/skills/*/SKILL.md',
	'.cursor/skills/*/SKILL.md',
];

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

export async function discoverSkills(): Promise<SkillInfo[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const out: SkillInfo[] = [];
	const seen = new Set<string>();
	for (const glob of SKILL_GLOBS) {
		const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), undefined, 40);
		for (const uri of uris) {
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				const raw = new TextDecoder().decode(bytes);
				const parsed = parseFrontmatter(raw);
				const parts = uri.path.split('/');
				const folderName = parts[parts.length - 2] ?? 'skill';
				const name = (parsed.name || folderName).trim();
				if (seen.has(name.toLowerCase())) {
					continue;
				}

				seen.add(name.toLowerCase());
				const body = parsed.body.length > MAX_SKILL_CHARS
					? `${parsed.body.slice(0, MAX_SKILL_CHARS)}\n\n[truncated]`
					: parsed.body;
				out.push({
					name,
					description: parsed.description || name,
					path: vscode.workspace.asRelativePath(uri),
					body,
				});
			} catch {
				continue;
			}
		}
	}
	return out;
}

export function formatSkillsCatalog(skills: SkillInfo[]): string | undefined {
	if (skills.length === 0) {
		return undefined;
	}
	
	const lines = skills.map((s) => `- ${s.name}: ${s.description} (${s.path})`);
	return `Доступные skills (загрузи через tool skill по имени):\n${lines.join('\n')}`;
}
