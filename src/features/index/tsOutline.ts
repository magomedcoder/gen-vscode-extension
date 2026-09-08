import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import { isProjectEnabled } from '../project/config';
import { listIndexableFiles, readIndexableText } from './scanner';
import { INDEX_DIR_RELATIVE } from './types';
import { isJsLikeOutlinePath, parseOutlineDocumentJson, parseRegexOutlineFallback, parseTsOutline, searchOutlineEntries, summarizeOutlineForPath, type OutlineDocument, type OutlineEntry } from './tsOutlineParse';

export type { OutlineDocument, OutlineEntry } from './tsOutlineParse';
export { isJsLikeOutlinePath, parseOutlineDocumentJson, parseRegexOutlineFallback, parseTsOutline, scoreOutlineQuery, searchOutlineEntries, summarizeOutlineForPath } from './tsOutlineParse';

export const OUTLINE_INDEX_RELATIVE = '.gen/index/outline.json';

export const OUTLINE_INDEX_LIMITS = {
	maxFiles: 400,
	maxEntries: 12_000,
	maxFileBytes: 400_000,
} as const;

export function outlinePathForFolder(folderFsPath: string): string {
	return path.join(folderFsPath, OUTLINE_INDEX_RELATIVE);
}

export async function loadOutlineIndex(folderFsPath: string): Promise<OutlineDocument | undefined> {
	try {
		const raw = await fs.readFile(outlinePathForFolder(folderFsPath), 'utf8');
		return parseOutlineDocumentJson(raw);
	} catch {
		return undefined;
	}
}

export async function saveOutlineIndex(folderFsPath: string, doc: OutlineDocument): Promise<void> {
	await fs.mkdir(path.join(folderFsPath, INDEX_DIR_RELATIVE), { recursive: true });
	await fs.writeFile(outlinePathForFolder(folderFsPath), JSON.stringify(doc, null, 2), 'utf8');
}

export function extractOutlineForFile(relativePath: string, sourceText: string): OutlineEntry[] {
	if (isJsLikeOutlinePath(relativePath)) {
		return parseTsOutline(relativePath, sourceText);
	}

	// Другие языки: дешёвый regex-fallback (опционально)
	const lower = relativePath.toLowerCase();
	if (/\.(py|go|rs|java|kt|rb)$/.test(lower)) {
		return parseRegexOutlineFallback(relativePath, sourceText);
	}
	return [];
}

// Пересобрать `.gen/index/outline.json` из индексируемых TS/JS (и regex-fallback языков)
export async function rebuildOutlineIndex(folder: vscode.WorkspaceFolder): Promise<OutlineDocument> {
	const files = await listIndexableFiles(folder);
	const entries: OutlineEntry[] = [];
	let fileCount = 0;

	for (const file of files) {
		if (entries.length >= OUTLINE_INDEX_LIMITS.maxEntries) {
			break;
		}

		if (fileCount >= OUTLINE_INDEX_LIMITS.maxFiles) {
			break;
		}

		if (
			!isJsLikeOutlinePath(file.relative) &&
			!/\.(py|go|rs|java|kt|rb)$/i.test(file.relative)
		) {
			continue;
		}

		try {
			const text = await readIndexableText(file.uri);
			if (!text) {
				continue;
			}

			const clipped = text.length > OUTLINE_INDEX_LIMITS.maxFileBytes
					? text.slice(0, OUTLINE_INDEX_LIMITS.maxFileBytes)
					: text;
			const part = extractOutlineForFile(file.relative, clipped);
			if (part.length === 0) {
				continue;
			}
			fileCount += 1;
			for (const e of part) {
				if (entries.length >= OUTLINE_INDEX_LIMITS.maxEntries) {
					break;
				}
				entries.push(e);
			}
		} catch {
			continue;
		}
	}

	const doc: OutlineDocument = {
		updatedAt: new Date().toISOString(),
		fileCount,
		entries,
	};
	await saveOutlineIndex(folder.uri.fsPath, doc);
	return doc;
}

export async function maybeRefreshOutlineIndex(folder: vscode.WorkspaceFolder): Promise<void> {
	if (getSettings().indexingEnabled === false) {
		return;
	}

	if (!(await isProjectEnabled(folder.uri.fsPath))) {
		return;
	}

	try {
		await rebuildOutlineIndex(folder);
	} catch {}
}

export async function findInOutlineIndex(
	query: string,
	maxResults: number,
): Promise<OutlineEntry[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const doc = await loadOutlineIndex(folder.uri.fsPath);
	if (!doc?.entries.length) {
		return [];
	}

	return searchOutlineEntries(query, doc.entries, maxResults);
}
