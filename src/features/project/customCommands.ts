import * as vscode from 'vscode';
import type { ChatMode } from '../../core/config/types';
import type { SlashCommand } from '../chat/slashCommands';

export interface CustomCommand {
	name: string;
	title?: string;
	description?: string;
	mode?: ChatMode;
	model?: string;
	body: string;
	path: string;
}

const MAX_BODY_CHARS = 32_000;
const MODES = new Set<ChatMode>(['ask', 'agent', 'debug', 'design', 'plan', 'multitask']);

function parseFrontmatter(raw: string): {
	title?: string;
	description?: string;
	mode?: ChatMode;
	model?: string;
	body: string;
} {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw.trim());
	if (!match) {
		return { body: raw.trim() };
	}

	const meta = match[1]!;
	const body = match[2]!.trim();
	const title = /^\s*title:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	const description = /^\s*description:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	const agentRaw = (/^\s*(?:agent|mode):\s*(.+)$/m.exec(meta)?.[1] ?? '').trim().toLowerCase();
	const model = /^\s*model:\s*(.+)$/m.exec(meta)?.[1]?.trim();
	const mode = MODES.has(agentRaw as ChatMode) ? (agentRaw as ChatMode) : undefined;
	return { title, description, mode, model, body };
}

function fileStem(uri: vscode.Uri): string {
	const base = uri.path.split('/').pop() ?? 'command';
	return base.replace(/\.md$/i, '');
}

// Обнаружить кастомные slash-команды из `.gen/commands/*.md`
export async function discoverCustomCommands(): Promise<CustomCommand[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const uris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '.gen/commands/*.md'),
		undefined,
		80,
	);
	const out: CustomCommand[] = [];
	const seen = new Set<string>();

	for (const uri of uris) {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const raw = new TextDecoder().decode(bytes);
			const parsed = parseFrontmatter(raw);
			const name = fileStem(uri).trim().toLowerCase();
			if (!name || !/^[a-z][\w-]*$/i.test(name) || seen.has(name)) {
				continue;
			}

			seen.add(name);
			const body = parsed.body.length > MAX_BODY_CHARS
				? `${parsed.body.slice(0, MAX_BODY_CHARS)}\n\n[truncated]`
				: parsed.body;
			out.push({
				name,
				title: parsed.title,
				description: parsed.description,
				mode: parsed.mode,
				model: parsed.model,
				body,
				path: vscode.workspace.asRelativePath(uri),
			});
		} catch {
			continue;
		}
	}

	return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function customToSlashCommand(cmd: CustomCommand): SlashCommand {
	return {
		id: `custom:${cmd.name}`,
		name: cmd.name,
		detail: cmd.description || cmd.title || cmd.name,
		mode: cmd.mode,
	};
}

// Подставить $ARGUMENTS и $1...$n в шаблон команды
export function expandCommandTemplate(body: string, argsText: string): string {
	const trimmed = argsText.trim();
	const parts = splitTemplateArgs(trimmed);
	let out = body.replace(/\$ARGUMENTS/g, trimmed);
	out = out.replace(/\$(\d+)/g, (_m, n: string) => {
		const idx = Number(n) - 1;
		return idx >= 0 && idx < parts.length ? parts[idx]! : '';
	});
	return out.trim();
}

function splitTemplateArgs(text: string): string[] {
	if (!text) {
		return [];
	}

	const parts: string[] = [];
	let cur = '';
	let quote: '"' | "'" | undefined;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i]!;
		if (quote) {
			if (ch === quote) {
				quote = undefined;
			} else {
				cur += ch;
			}

			continue;
		}

		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}

		if (/\s/.test(ch)) {
			if (cur) {
				parts.push(cur);
				cur = '';
			}
			continue;
		}

		cur += ch;
	}

	if (cur) {
		parts.push(cur);
	}

	return parts;
}
