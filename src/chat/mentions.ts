import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { buildCodebaseContextPack, collectFileHit, collectFolderHits, packContext } from '../index/contextEngine';
import type { ContextHit } from '../index/contextEngine';
import { semanticSearchWorkspace } from '../index/embeddings';
import { getSettings } from '../config/settings';
import { loadProjectRulesAppendix } from '../project/projectRules';

export type MentionKind = 'file' | 'folder' | 'codebase' | 'code' | 'git' | 'branch_diff' | 'rules' | 'link' | 'docs' | 'agent';

export interface ParsedMention {
	kind: MentionKind;
	arg?: string;
	raw: string;
	start: number;
	end: number;
}

export interface ResolvedMentions {
	cleanText: string;
	mentions: ParsedMention[];
	contextText: string;
	labels: string[];
}

// codebase раньше code - иначе @codebase сматчится как @code + arg "base"
const MENTION_RE = /@(file|folder|codebase|code|git|branch_diff|rules|link|docs|agent)(?:\s+`([^`]+)`|:([^\s]+)|(?:\s+)([^\s@]+))?/gi;

function git(args: string[]): Promise<string> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		return Promise.resolve('');
	}

	return new Promise((resolve) => {
		const c = spawn('git', args, { cwd: root });
		let o = '';
		c.stdout.on('data', (d) => {
			o += String(d);
		});
		c.on('error', () => resolve(''));
		c.on('close', () => resolve(o.trim()));
	});
}

function slugifyAgentName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9_-]/g, '')
		.slice(0, 48);
}

// Выделение или символ рядом с курсором -> блок контекста
async function resolveCodeContext(): Promise<string> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return '[code] нет активного редактора';
	}

	const doc = editor.document;
	const relative = vscode.workspace.asRelativePath(doc.uri, false).replace(/\\/g, '/');
	const maxChars = getSettings().maxInputChars;
	const sel = editor.selection;

	if (!sel.isEmpty) {
		const text = doc.getText(sel);
		const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n...` : text;
		const start = sel.start.line + 1;
		const end = sel.end.line + 1;
		return `[code selection ${relative}:${start}-${end}]\n${clipped}`;
	}

	const pos = sel.active;
	const wordRange = doc.getWordRangeAtPosition(pos);
	const symbolName = wordRange ? doc.getText(wordRange) : '';

	try {
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			'vscode.executeDocumentSymbolProvider',
			doc.uri,
		);
		if (symbols?.length) {
			const flat: vscode.DocumentSymbol[] = [];
			const walk = (items: vscode.DocumentSymbol[]) => {
				for (const s of items) {
					flat.push(s);
					if (s.children?.length) {
						walk(s.children);
					}
				}
			};
			walk(symbols);
			const enclosing = flat.filter((s) => s.range.contains(pos))
				.sort((a, b) => (a.range.end.line - a.range.start.line) - (b.range.end.line - b.range.start.line))[0];
			if (enclosing) {
				const body = doc.getText(enclosing.range);
				const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}\n...` : body;
				return `[code symbol ${relative} ${enclosing.name} (${enclosing.range.start.line + 1}-${enclosing.range.end.line + 1})]\n${clipped}`;
			}
		}
	} catch {}

	const startLine = Math.max(0, pos.line - 8);
	const endLine = Math.min(doc.lineCount - 1, pos.line + 24);
	const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
	const body = doc.getText(range);
	const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}\n...` : body;
	const label = symbolName ? `near «${symbolName}»` : 'cursor';
	return `[code ${label} ${relative}:${startLine + 1}-${endLine + 1}]\n${clipped}`;
}

// Поиск по docs/ и markdown (как search_docs)
async function resolveDocsContext(query: string): Promise<string> {
	const q = query.trim() || 'docs';
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return '[Docs] нет workspace';
	}

	try {
		const hits = await semanticSearchWorkspace(q, { maxFiles: 30, maxResults: 6 });
		const docs = hits.filter((h) => /(^|\/)(docs?|documentation)\//i.test(h.path) || /\.md$/i.test(h.path));
		const picked = docs.length ? docs : hits;
		if (picked.length) {
			const lines = picked.map((h) => {
				const snip = (h.snippet ?? '').slice(0, 1200);
				return `[Docs ${h.path}]\n${snip}`;
			});
			return lines.join('\n\n').slice(0, 12_000);
		}
	} catch {}

	const patterns = ['docs/**/*.md', 'Documentation/**/*.md', 'doc/**/*.md', '*.md'];
	const blocks: string[] = [];
	const needle = q.toLowerCase();

	for (const pattern of patterns) {
		const uris = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, pattern),
			'**/{.gen,node_modules,.git}/**',
			20,
		);

		for (const uri of uris) {
			const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
			if (needle && needle !== 'docs' && !relative.toLowerCase().includes(needle)) {
				try {
					const raw = await vscode.workspace.fs.readFile(uri);
					const text = new TextDecoder('utf8', { fatal: false }).decode(raw);
					if (!text.toLowerCase().includes(needle)) {
						continue;
					}

					blocks.push(`[Docs ${relative}]\n${text.slice(0, 2000)}`);
				} catch {
					continue;
				}
			} else {
				try {
					const raw = await vscode.workspace.fs.readFile(uri);
					const text = new TextDecoder('utf8', { fatal: false }).decode(raw);
					blocks.push(`[Docs ${relative}]\n${text.slice(0, 2000)}`);
				} catch {
					continue;
				}
			}
			if (blocks.length >= 6) {
				break;
			}
		}

		if (blocks.length >= 6) {
			break;
		}
	}

	return blocks.length
		? blocks.join('\n\n').slice(0, 12_000)
		: `[Docs] ничего не найдено по запросу «${q}»`;
}

// Тело `.gen/agents/{name}.md` в контекст
async function resolveAgentContext(name: string | undefined): Promise<string> {
	if (!name?.trim()) {
		return '[agent] укажи имя: @agent name';
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return '[agent] нет workspace';
	}

	const rawName = name.trim();
	const slug = slugifyAgentName(rawName);
	const candidates = [
		`${rawName}.md`,
		`${slug}.md`,
		`${rawName.toLowerCase()}.md`,
	];
	const seen = new Set<string>();

	for (const file of candidates) {
		if (seen.has(file)) {
			continue;
		}

		seen.add(file);
		const uri = vscode.Uri.joinPath(folder.uri, '.gen', 'agents', file);
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			let text = new TextDecoder('utf8', { fatal: false }).decode(bytes);
			const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(text.trim());
			if (fm) {
				text = fm[1]!.trim();
			}

			const clipped = text.length > 12_000 ? `${text.slice(0, 12_000)}\n\n[truncated]` : text;
			const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
			return `[agent ${rawName} -> ${relative}]\n${clipped}`;
		} catch {
			continue;
		}
	}

	// Поиск по glob, если точное имя не совпало
	const uris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '.gen/agents/*.md'),
		undefined,
		40,
	);

	const needle = slug || rawName.toLowerCase();
	for (const uri of uris) {
		const base = (uri.path.split('/').pop() ?? '').replace(/\.md$/i, '').toLowerCase();
		if (base === needle || base.includes(needle)) {
			try {
				const bytes = await vscode.workspace.fs.readFile(uri);
				let text = new TextDecoder('utf8', { fatal: false }).decode(bytes);
				const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(text.trim());
				if (fm) {
					text = fm[1]!.trim();
				}

				const clipped = text.length > 12_000 ? `${text.slice(0, 12_000)}\n\n[truncated]` : text;
				const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
				return `[agent ${rawName} -> ${relative}]\n${clipped}`;
			} catch {
				continue;
			}
		}
	}

	return `[agent] файл .gen/agents/${slug || rawName}.md не найден`;
}

export function parseMentions(text: string): ParsedMention[] {
	const out: ParsedMention[] = [];
	for (const match of text.matchAll(MENTION_RE)) {
		const kind = match[1]!.toLowerCase() as MentionKind;
		const arg = (match[2] ?? match[3] ?? match[4] ?? '').trim() || undefined;
		const start = match.index ?? 0;
		out.push({
			kind,
			arg,
			raw: match[0],
			start,
			end: start + match[0].length,
		});
	}

	return out;
}

export function stripMentions(text: string, mentions: readonly ParsedMention[]): string {
	if (mentions.length === 0) {
		return text.trim();
	}

	let result = text;
	for (let i = mentions.length - 1; i >= 0; i -= 1) {
		const m = mentions[i]!;
		result = result.slice(0, m.start) + result.slice(m.end);
	}

	return result.replace(/\s+/g, ' ').trim();
}

export async function resolveMentions(text: string): Promise<ResolvedMentions> {
	const mentions = parseMentions(text);
	if (mentions.length === 0) {
		return {
			cleanText: text.trim(),
			mentions: [],
			contextText: '',
			labels: [],
		};
	}

	const cleanText = stripMentions(text, mentions);
	const hits: ContextHit[] = [];
	const labels: string[] = [];
	const extraBlocks: string[] = [];

	for (const mention of mentions) {
		if (mention.kind === 'file') {
			if (!mention.arg) {
				labels.push('@file(?)');
				continue;
			}

			labels.push(`@file ${mention.arg}`);
			const hit = await collectFileHit(mention.arg.replace(/\\/g, '/'));
			if (hit) {
				hits.push(hit);
			}

			continue;
		}

		if (mention.kind === 'folder') {
			if (!mention.arg) {
				labels.push('@folder(?)');
				continue;
			}

			labels.push(`@folder ${mention.arg}`);
			hits.push(...await collectFolderHits(mention.arg.replace(/\\/g, '/')));
			continue;
		}

		if (mention.kind === 'codebase') {
			labels.push(mention.arg ? `@codebase ${mention.arg}` : '@codebase');
			const pack = await buildCodebaseContextPack(mention.arg ?? (cleanText || 'project'));
			hits.push(...pack.hits);
			continue;
		}

		if (mention.kind === 'code') {
			labels.push('@code');
			extraBlocks.push(await resolveCodeContext());
			continue;
		}

		if (mention.kind === 'docs') {
			labels.push(mention.arg ? `@Docs ${mention.arg}` : '@Docs');
			extraBlocks.push(await resolveDocsContext(mention.arg ?? cleanText));
			continue;
		}

		if (mention.kind === 'agent') {
			labels.push(mention.arg ? `@agent ${mention.arg}` : '@agent(?)');
			extraBlocks.push(await resolveAgentContext(mention.arg));
			continue;
		}

		if (mention.kind === 'git') {
			const sha = mention.arg?.trim();
			labels.push(sha ? `@git ${sha}` : '@git');
			const log = sha
				? await git(['show', '--stat', '--oneline', '-s', sha])
				: await git(['log', '-5', '--oneline']);
			if (log) {
				extraBlocks.push(`[git]\n${log.slice(0, 4000)}`);
			}

			continue;
		}

		if (mention.kind === 'branch_diff') {
			labels.push('@branch_diff');
			const diff = await git(['diff', '--stat', 'HEAD']);
			const status = await git(['status', '-sb']);
			extraBlocks.push(`[branch_diff]\n${status}\n${diff}`.slice(0, 6000));
			continue;
		}

		if (mention.kind === 'rules') {
			labels.push('@rules');
			const rules = await loadProjectRulesAppendix();
			if (rules) {
				extraBlocks.push(rules);
			}

			continue;
		}

		if (mention.kind === 'link') {
			const url = mention.arg?.trim();
			labels.push(url ? `@link ${url}` : '@link(?)');
			if (url) {
				try {
					const res = await fetch(url.startsWith('http') ? url : `https://${url}`, {
						signal: AbortSignal.timeout(10_000),
					});
					const body = (await res.text()).slice(0, 8000);
					extraBlocks.push(`[link ${url}]\n${body}`);
				} catch (err) {
					extraBlocks.push(`[link ${url}] error: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}
	}

	const pack = packContext(hits, 24_000);
	const contextText = [pack.text, ...extraBlocks].filter(Boolean).join('\n\n');

	return {
		cleanText,
		mentions,
		contextText,
		labels,
	};
}
