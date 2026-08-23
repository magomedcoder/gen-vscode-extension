export const INDEX_MANIFEST_VERSION = 1;
export const INDEX_DIR_RELATIVE = '.gen/index';
export const INDEX_MANIFEST_RELATIVE = '.gen/index/manifest.json';

export interface IndexChunk {
	id: string;
	path: string;
	startLine: number;
	endLine: number;
	text: string;
}

export interface IndexFileRecord {
	hash: string;
	size: number;
	chunkIds: string[];
}

export interface IndexManifest {
	version: number;
	updatedAt: string;
	files: Record<string, IndexFileRecord>;
	chunks: Record<string, IndexChunk>;
	trigrams: Record<string, string[]>;
}

export interface CodebaseSearchHit {
	chunkId: string;
	path: string;
	startLine: number;
	endLine: number;
	score: number;
	snippet: string;
}

export interface IndexProgress {
	state: 'idle' | 'indexing' | 'ready' | 'error';
	fileCount: number;
	chunkCount: number;
	lastError?: string;
}

export function emptyManifest(): IndexManifest {
	return {
		version: INDEX_MANIFEST_VERSION,
		updatedAt: new Date(0).toISOString(),
		files: {},
		chunks: {},
		trigrams: {},
	};
}
