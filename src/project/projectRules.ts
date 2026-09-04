import * as vscode from 'vscode';
import { formatGenRulesForPrompt, GENRULES_RELATIVE, MAX_GENRULES_CHARS, normalizeGenRulesText } from './genrules';

const RULE_FILES = [
	GENRULES_RELATIVE,
	'AGENTS.md',
];

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder().decode(bytes);
	} catch {
		return undefined;
	}
}

// Собрать .genrules + AGENTS.md в один appendix к prompt
export async function loadProjectRulesAppendix(): Promise<string | undefined> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return undefined;
	}

	const chunks: string[] = [];
	for (const rel of RULE_FILES) {
		const text = await readText(vscode.Uri.joinPath(folder.uri, rel));
		const normalized = text ? normalizeGenRulesText(text) : undefined;
		if (normalized) {
			chunks.push(`### ${rel}\n${normalized}`);
		}
	}

	if (chunks.length === 0) {
		return undefined;
	}

	let merged = chunks.join('\n\n');
	if (merged.length > MAX_GENRULES_CHARS * 2) {
		merged = `${merged.slice(0, MAX_GENRULES_CHARS * 2)}\n\n[Gen: rules truncated]`;
	}

	return formatGenRulesForPrompt(merged);
}
