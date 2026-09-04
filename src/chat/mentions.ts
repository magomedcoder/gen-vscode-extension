import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { buildCodebaseContextPack, collectFileHit, collectFolderHits, packContext } from '../index/contextEngine';
import type { ContextHit } from '../index/contextEngine';
import { loadProjectRulesAppendix } from '../project/projectRules';

export type MentionKind = 'file' | 'folder' | 'codebase' | 'git' | 'branch_diff' | 'rules' | 'link';

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

const MENTION_RE = /@(file|folder|codebase|git|branch_diff|rules|link)(?:\s+`([^`]+)`|:([^\s]+)|(?:\s+)([^\s@]+))?/gi;

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
