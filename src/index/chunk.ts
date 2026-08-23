import type { IndexChunk } from './types';

export const CHUNK_LIMITS = {
	maxChunkLines: 120,
	minChunkLines: 6,
	maxChunkChars: 6_000,
	maxChunksPerFile: 80,
} as const;

const SYMBOL_START = /^(export\s+)?(async\s+)?(function\s+\w|class\s+\w|interface\s+\w|type\s+\w|enum\s+\w|const\s+\w+\s*=|let\s+\w+\s*=|def\s+\w|func\s+\(|fn\s+\w|impl\s+|pub\s+(async\s+)?fn\s+)/;

function chunkId(path: string, startLine: number, endLine: number): string {
	return `${path}#${startLine}-${endLine}`;
}

function pushChunk(out: IndexChunk[], path: string, lines: string[], startLine: number): void {
	if (lines.length === 0) {
		return;
	}

	const text = lines.join('\n').trimEnd();
	if (!text.trim()) {
		return;
	}

	const endLine = startLine + lines.length - 1;
	out.push({
		id: chunkId(path, startLine, endLine),
		path,
		startLine,
		endLine,
		text,
	});
}

function splitOversized(path: string, lines: string[], startLine: number, out: IndexChunk[]): void {
	let cursor = 0;
	while (cursor < lines.length) {
		const slice = lines.slice(cursor, cursor + CHUNK_LIMITS.maxChunkLines);
		pushChunk(out, path, slice, startLine + cursor);
		cursor += CHUNK_LIMITS.maxChunkLines;
	}
}

// Эвристическая нарезка: границы символов + лимиты по строкам/символам
export function chunkFileContent(relativePath: string, content: string): IndexChunk[] {
	const lines = content.split(/\r?\n/);
	const out: IndexChunk[] = [];
	let block: string[] = [];
	let blockStart = 1;

	const flush = (): void => {
		if (block.length === 0) {
			return;
		}

		const joined = block.join('\n');
		if (joined.length > CHUNK_LIMITS.maxChunkChars || block.length > CHUNK_LIMITS.maxChunkLines) {
			splitOversized(relativePath, block, blockStart, out);
		} else {
			pushChunk(out, relativePath, block, blockStart);
		}

		block = [];
	};

	for (let i = 0; i < lines.length; i += 1) {
		const lineNo = i + 1;
		const line = lines[i];

		if (block.length > 0 && SYMBOL_START.test(line.trim()) && block.length >= CHUNK_LIMITS.minChunkLines) {
			flush();
		}

		if (block.length === 0) {
			blockStart = lineNo;
		}

		block.push(line);

		if (block.length >= CHUNK_LIMITS.maxChunkLines) {
			flush();
		}
	}

	flush();

	if (out.length > CHUNK_LIMITS.maxChunksPerFile) {
		return out.slice(0, CHUNK_LIMITS.maxChunksPerFile);
	}

	return out;
}
