import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { buildCodebaseContextPack, collectFileHit, collectFolderHits, packContext } from '../index/contextEngine';
import type { ContextHit } from '../index/contextEngine';
import { semanticSearchWorkspace } from '../index/embeddings';
import { getProjectMap } from '../index/projectMap';
import { formatSymbolIndexSummary } from '../index/symbolIndex';
import { getSettings } from '../../core/config/settings';
import { loadProjectRulesAppendix } from '../project/projectRules';
import { collectReferenceHits, ensureReferenceCached, formatReferenceSourceBlock } from '../project/references';
import { ensureTerminalBufferListener, getTerminalBuffers } from './terminalBuffer';
import { getSessionPeek } from './sessionStore';
import type { ChatUiMessage } from './protocol';

export type MentionKind = 'file' | 'folder' | 'codebase' | 'code' | 'git' | 'branch_diff' | 'rules' | 'link' | 'docs' | 'agent' | 'terminals' | 'past' | 'alias' | 'ref' | 'map' | 'symbols';

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
// symbols раньше symbol* ; map - отдельный kind
const MENTION_RE = /@(file|folder|codebase|code|git|branch_diff|rules|link|docs|agent|terminals|past|alias|ref|map|symbols)(?:\s+`([^`]+)`|:`([^`]+)`|:([^\s`]+)|(?:\s+)([^\s@]+))?/gi;

// Kinds без аргумента: не глотать следующее слово как arg
const ARGLESS_MENTION_KINDS = new Set<MentionKind>(['code', 'git', 'branch_diff', 'rules', 'terminals', 'map']);

function stripOuterBackticks(value: string): string {
	const t = value.trim();
	if (t.length >= 2 && t.startsWith('`') && t.endsWith('`')) {
		return t.slice(1, -1).trim();
	}

	return t;
}

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
	return name.trim()
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
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri);
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
			const enclosing = flat.filter((s) => s.range.contains(pos)).sort((a, b) => (a.range.end.line - a.range.start.line) - (b.range.end.line - b.range.start.line))[0];
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
		const hits = await semanticSearchWorkspace(q, {
			maxFiles: 30,
			maxResults: 6
		});
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

// Хвосты вывода открытых терминалов (ring-буфер из terminalBuffer)
function resolveTerminalsContext(): string {
	ensureTerminalBufferListener();
	const perCap = Math.min(4_000, getSettings().maxInputChars);
	const terminals = getTerminalBuffers();
	if (terminals.length === 0) {
		return '[terminals] нет открытых терминалов';
	}

	const blocks = terminals.map((t) => {
		const body = t.text.trim()
			? (t.text.length > perCap ? `${t.text.slice(-perCap)}\n...` : t.text)
			: '(нет буферизованного вывода - выполни команду в терминале)';
		return `[terminal ${t.name}]\n${body}`;
	});
	return blocks.join('\n\n').slice(0, Math.min(24_000, getSettings().maxInputChars * 3));
}

const PAST_MSG_ROLES = new Set(['user', 'assistant']);
const PAST_LAST_N = 12;

function lastUserSnippet(messages: ChatUiMessage[], maxLen = 120): string {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const m = messages[i]!;
		if (m.role === 'user' && m.content.trim()) {
			const line = m.content.trim().replace(/\s+/g, ' ');
			return line.length > maxLen ? `${line.slice(0, maxLen - 1)}...` : line;
		}
	}

	return '';
}

function formatPastMessages(messages: ChatUiMessage[], budget: number): string {
	const picked = messages.filter((m) => PAST_MSG_ROLES.has(m.role) && m.content.trim()).slice(-PAST_LAST_N);
	const blocks: string[] = [];
	let used = 0;
	for (const m of picked) {
		const role = m.role === 'user' ? 'user' : 'assistant';
		const body = m.content.trim();
		const remaining = budget - used;
		if (remaining <= 40) {
			blocks.push('...');
			break;
		}

		const clipped = body.length > remaining ? `${body.slice(0, remaining)}\n...` : body;
		const block = `${role}:\n${clipped}`;
		blocks.push(block);
		used += block.length + 2;
	}

	return blocks.join('\n\n');
}

// Прошлые чаты из SessionStore (через setSessionPeek)
function resolvePastChat(arg?: string): string {
	const store = getSessionPeek();
	if (!store) {
		return '[past] нет доступа к сессиям';
	}

	const maxChars = getSettings().maxInputChars;
	const needle = arg?.trim();
	const currentId = store.getCurrentSessionId();

	if (needle) {
		const lower = needle.toLowerCase();
		const summaries = store.listSessions();
		const byId = summaries.find((s) => s.id === needle);
		const byExactTitle = summaries.find((s) => s.title.toLowerCase() === lower);
		const bySub = summaries.find((s) => s.title.toLowerCase().includes(lower));
		const hit = byId ?? byExactTitle ?? bySub;
		if (!hit) {
			return `[past] сессия «${needle}» не найдена`;
		}

		const session = store.getSession(hit.id);
		if (!session) {
			return `[past] сессия «${hit.title}» не найдена`;
		}

		const body = formatPastMessages(session.messages, maxChars);
		if (!body) {
			return `[past ${session.title}]\n(нет сообщений)`;
		}

		return `[past ${session.title}]\n${body}`.slice(0, maxChars + 200);
	}

	// Без arg - список недавних сессий (без текущей)
	const recent = store.listSessions().filter((s) => s.id !== currentId).slice(0, 12);
	if (recent.length === 0) {
		return '[past] нет других сохранённых чатов';
	}

	const lines = recent.map((s) => {
		const session = store.getSession(s.id);
		const snip = session ? lastUserSnippet(session.messages) : '';
		const tail = snip ? ` - ${snip}` : '';
		return `- ${s.title}${tail}`;
	});
	return `[past chats]\n${lines.join('\n')}`.slice(0, maxChars);
}

export function parseMentions(text: string): ParsedMention[] {
	const out: ParsedMention[] = [];
	for (const match of text.matchAll(MENTION_RE)) {
		const kind = match[1]!.toLowerCase() as MentionKind;
		const rawMatch = match[0];
		const start = match.index ?? 0;
		let arg = (match[2] ?? match[3] ?? match[4] ?? match[5] ?? '').trim() || undefined;
		let end = start + rawMatch.length;

		// kinds без arg: не съедать следующее слово (`@terminals что` * только @terminals)
		if (ARGLESS_MENTION_KINDS.has(kind) && arg && !rawMatch.includes('`') && !rawMatch.includes(':')) {
			const kindOnly = `@${kind}`;
			arg = undefined;
			end = start + kindOnly.length;
			out.push({
				kind,
				arg,
				raw: text.slice(start, end),
				start,
				end,
			});
			continue;
		}

		if (arg) {
			arg = stripOuterBackticks(arg) || undefined;
		}

		out.push({
			kind,
			arg,
			raw: rawMatch,
			start,
			end,
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

		if (mention.kind === 'map') {
			labels.push('@map');
			try {
				const map = await getProjectMap();
				extraBlocks.push(`[map]\n${map.outline}`.slice(0, 12_000));
			} catch (err) {
				extraBlocks.push(`[map] ${err instanceof Error ? err.message : String(err)}`);
			}
			continue;
		}

		if (mention.kind === 'symbols') {
			labels.push(mention.arg ? `@symbols ${mention.arg}` : '@symbols');
			extraBlocks.push(await formatSymbolIndexSummary(mention.arg ?? (cleanText || undefined)));
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

			continue;
		}

		if (mention.kind === 'terminals') {
			labels.push('@terminals');
			extraBlocks.push(resolveTerminalsContext());
			continue;
		}

		if (mention.kind === 'past') {
			labels.push(mention.arg ? `@past ${mention.arg}` : '@past');
			extraBlocks.push(resolvePastChat(mention.arg));
			continue;
		}

		if (mention.kind === 'alias' || mention.kind === 'ref') {
			const name = mention.arg?.trim();
			const tag = mention.kind === 'ref' ? '@ref' : '@alias';
			labels.push(name ? `${tag} ${name}` : `${tag}(?)`);
			if (!name) {
				extraBlocks.push(`[alias] укажи имя: @alias name или @ref:name`);
				continue;
			}

			const resolved = await ensureReferenceCached(name);
			if ('error' in resolved) {
				extraBlocks.push(`[alias ${name}] ${resolved.error}`);
				continue;
			}

			extraBlocks.push(formatReferenceSourceBlock(resolved));
			hits.push(...await collectReferenceHits(resolved));
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
