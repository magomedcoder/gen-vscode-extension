import * as vscode from 'vscode';
import { CommandPolicyError } from '../agent/commandPolicy';
import { runShellCommand } from '../agent/shellExec';
import { AGENT_LIMITS, previewText } from '../agent/policy';

export interface BangMatch {
	raw: string;
	commandLine: string;
	start: number;
	end: number;
}

export interface BangResolveResult {
	cleanText: string;
	contextText?: string;
	ran: number;
	errors: string[];
}

const MAX_BANG_OUTPUT = 8_000;
const MAX_BANGS = 4;

// `` `!cmd args` `` или `!cmd args` (начало строки / после пробела)
const BANG_RE = /`!([^`]+)`|(?:^|\s)!([^\n`]+)/g;

export function parseBangCommands(text: string): BangMatch[] {
	const out: BangMatch[] = [];
	for (const match of text.matchAll(BANG_RE)) {
		const commandLine = (match[1] ?? match[2] ?? '').trim();
		if (!commandLine) {
			continue;
		}

		const start = match.index ?? 0;
		out.push({
			raw: match[0],
			commandLine,
			start,
			end: start + match[0].length,
		});
		if (out.length >= MAX_BANGS) {
			break;
		}
	}
	return out;
}

export function splitCommandLine(line: string): { command: string; args: string[] } | undefined {
	const parts = tokenize(line.trim());
	if (parts.length === 0) {
		return undefined;
	}

	return {
		command: parts[0]!,
		args: parts.slice(1),
	};
}

function tokenize(text: string): string[] {
	const parts: string[] = [];
	let cur = '';
	let quote: '"' | "'" | undefined;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i]!;
		if (quote) {
			if (ch === '\\' && i + 1 < text.length) {
				cur += text[i + 1]!;
				i += 1;
				continue;
			}

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

function stripBangs(text: string, bangs: readonly BangMatch[]): string {
	if (bangs.length === 0) {
		return text.trim();
	}

	let result = text;
	for (let i = bangs.length - 1; i >= 0; i -= 1) {
		const b = bangs[i]!;
		result = result.slice(0, b.start) + result.slice(b.end);
	}

	return result.replace(/\n{3,}/g, '\n\n').trim();
}

// Выполнить !команды и вернуть stdout в контекст
export async function resolveBangCommands(text: string, signal?: AbortSignal): Promise<BangResolveResult> {
	const bangs = parseBangCommands(text);
	if (bangs.length === 0) {
		return {
			cleanText: text.trim(),
			ran: 0,
			errors: [],
		};
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	const cwd = folder?.uri.fsPath ?? process.cwd();
	const blocks: string[] = [];
	const errors: string[] = [];

	for (const bang of bangs) {
		const parsed = splitCommandLine(bang.commandLine);
		if (!parsed) {
			errors.push(vscode.l10n.t('chat.bang.empty'));
			continue;
		}

		try {
			const result = await runShellCommand({
				command: parsed.command,
				args: parsed.args,
				cwd,
				timeoutMs: Math.min(30_000, AGENT_LIMITS.defaultCommandTimeoutMs),
				signal,
			});
			const body = previewText(result.content, MAX_BANG_OUTPUT);
			blocks.push(`### !${bang.commandLine}\n\`\`\`\n${body}\n\`\`\``);
			if (!result.ok) {
				errors.push(vscode.l10n.t('chat.bang.failed', bang.commandLine, result.exitCode));
			}
		} catch (err) {
			const msg = err instanceof CommandPolicyError || err instanceof Error
				? err.message
				: String(err);
			errors.push(msg);
			blocks.push(`### !${bang.commandLine}\n\`\`\`\n${msg}\n\`\`\``);
		}
	}

	const contextText = blocks.length > 0
		? `Вывод !команд:\n\n${blocks.join('\n\n')}`
		: undefined;

	return {
		cleanText: stripBangs(text, bangs),
		contextText,
		ran: bangs.length,
		errors,
	};
}
