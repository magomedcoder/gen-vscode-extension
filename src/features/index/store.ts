import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { emptyManifest, INDEX_DIR_RELATIVE, INDEX_MANIFEST_RELATIVE, INDEX_MANIFEST_VERSION } from './types';
import type { IndexManifest } from './types';

export function manifestPathForFolder(folderFsPath: string): string {
	return path.join(folderFsPath, INDEX_MANIFEST_RELATIVE);
}

export async function ensureIndexDir(folderFsPath: string): Promise<void> {
	await fs.mkdir(path.join(folderFsPath, INDEX_DIR_RELATIVE), {
		recursive: true
	});
}

export async function loadManifest(folderFsPath: string): Promise<IndexManifest> {
	try {
		const raw = await fs.readFile(manifestPathForFolder(folderFsPath), 'utf8');
		const parsed = JSON.parse(raw) as IndexManifest;
		if (parsed.version !== INDEX_MANIFEST_VERSION) {
			return emptyManifest();
		}

		return parsed;
	} catch {
		return emptyManifest();
	}
}

export async function saveManifest(folderFsPath: string, manifest: IndexManifest): Promise<void> {
	await ensureIndexDir(folderFsPath);
	manifest.updatedAt = new Date().toISOString();
	await fs.writeFile(manifestPathForFolder(folderFsPath), JSON.stringify(manifest, null, 2), 'utf8');
}
