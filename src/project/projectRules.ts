import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getSettings } from '../config/settings';
import { fetchHttpsText } from './fetchHttpsText';
import { formatGenRulesForPrompt, GENRULES_RELATIVE, MAX_GENRULES_CHARS, normalizeGenRulesText } from './genrules';

const RULE_FILES = [
	GENRULES_RELATIVE,
	'AGENTS.md',
];

const USER_AGENTS_RELATIVE = path.join('.config', 'gen', 'AGENTS.md');
const MAX_INSTRUCTION_URL_CHARS = 12_000;
const MAX_INSTRUCTION_URLS = 8;

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder().decode(bytes);
	} catch {
		return undefined;
	}
}

async function readUserAgentsMd(): Promise<string | undefined> {
	const filePath = path.join(os.homedir(), USER_AGENTS_RELATIVE);
	try {
		return await fs.readFile(filePath, 'utf8');
	} catch {
		return undefined;
	}
}

async function loadInstructionUrlsAppendix(): Promise<string[]> {
	const urls = getSettings().instructionUrls.slice(0, MAX_INSTRUCTION_URLS);
	if (urls.length === 0) {
		return [];
	}

	const chunks: string[] = [];
	for (const url of urls) {
		const result = await fetchHttpsText(url, MAX_INSTRUCTION_URL_CHARS);
		if (!result.ok) {
			continue;
		}

		const normalized = normalizeGenRulesText(result.text);
		if (normalized) {
			chunks.push(`### remote:${result.url}\n${normalized}`);
		}
	}
	return chunks;
}

// Собрать .genrules + AGENTS.md (+ user-level + instructionUrls) в appendix к prompt
export async function loadProjectRulesAppendix(): Promise<string | undefined> {
	const chunks: string[] = [];
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (folder) {
		for (const rel of RULE_FILES) {
			const text = await readText(vscode.Uri.joinPath(folder.uri, rel));
			const normalized = text ? normalizeGenRulesText(text) : undefined;
			if (normalized) {
				chunks.push(`### ${rel}\n${normalized}`);
			}
		}
	}

	// User-level правила - после проектных
	const userText = await readUserAgentsMd();
	const userNormalized = userText ? normalizeGenRulesText(userText) : undefined;
	if (userNormalized) {
		chunks.push(`### ~/.config/gen/AGENTS.md\n${userNormalized}`);
	}

	chunks.push(...(await loadInstructionUrlsAppendix()));

	if (chunks.length === 0) {
		return undefined;
	}

	let merged = chunks.join('\n\n');
	if (merged.length > MAX_GENRULES_CHARS * 2) {
		merged = `${merged.slice(0, MAX_GENRULES_CHARS * 2)}\n\n[Gen: rules truncated]`;
	}

	return formatGenRulesForPrompt(merged);
}
