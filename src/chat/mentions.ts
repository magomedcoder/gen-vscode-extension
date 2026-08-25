import { buildCodebaseContextPack, collectFileHit, collectFolderHits, packContext} from '../index/contextEngine';
import type { ContextHit } from '../index/contextEngine';
export type MentionKind = 'file' | 'folder' | 'codebase';

export interface ParsedMention {
	kind: MentionKind;
	arg?: string;
	raw: string;
	start: number;
	end: number;
}

export interface ResolvedMentions {
	// Текст без @-токенов (вопрос пользователя)
	cleanText: string;
	mentions: ParsedMention[];
	// Блок для подмешивания в LLM-контекст
	contextText: string;
	labels: string[];
}

const MENTION_RE = /@(file|folder|codebase)(?:\s+`([^`]+)`|:([^\s]+)|(?:\s+)([^\s@]+))?/gi;

export function parseMentions(text: string): ParsedMention[] {
	const out: ParsedMention[] = [];
	for (const match of text.matchAll(MENTION_RE)) {
		const kind = match[1].toLowerCase() as MentionKind;
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
		const m = mentions[i];
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

		const query = mention.arg?.trim() || cleanText;
		labels.push(mention.arg ? `@codebase ${mention.arg}` : '@codebase');
		if (query) {
			const pack = await buildCodebaseContextPack(query);
			hits.push(...pack.hits);
		}
	}

	const pack = packContext(hits);
	return {
		cleanText: cleanText || text.trim(),
		mentions,
		contextText: pack.text,
		labels,
	};
}
