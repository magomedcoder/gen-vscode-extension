import * as vscode from 'vscode';
import { isProjectEnabled } from '../project/config';
import { chunkFileContent } from './chunk';
import { contentHash } from './hash';
import { listIndexableFiles, readIndexableText } from './scanner';
import { loadManifest, saveManifest } from './store';
import { rebuildManifestTrigrams, searchTrigrams } from './trigram';
import type { CodebaseSearchHit, IndexManifest, IndexProgress } from './types';

export class IndexManager implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly progressByFolder = new Map<string, IndexProgress>();
	private indexing = new Set<string>();
	private indexed = new Set<string>();
	private readonly onChangeListeners = new Set<() => void>();

	constructor(private readonly context: vscode.ExtensionContext) {
		void this.bootstrapExisting();

		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders((e) => {
				for (const folder of e.added) {
					void this.maybeSchedule(folder);
				}

				for (const folder of e.removed) {
					this.progressByFolder.delete(folder.uri.fsPath);
					this.indexed.delete(folder.uri.fsPath);
				}
				this.notifyChanged();
			}),
			vscode.workspace.createFileSystemWatcher('**/*'),
		);

		const watcher = this.disposables[this.disposables.length - 1] as vscode.FileSystemWatcher;
		const onFsChange = (uri: vscode.Uri) => {
			void this.onWorkspaceFileChange(uri);
		};

		this.disposables.push(
			watcher.onDidChange(onFsChange),
			watcher.onDidCreate(onFsChange),
			watcher.onDidDelete((uri) => {
				void this.onWorkspaceFileDelete(uri);
			}),
		);
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}

		this.disposables.length = 0;
		this.onChangeListeners.clear();
	}

	onDidChange(listener: () => void): vscode.Disposable {
		this.onChangeListeners.add(listener);
		return {
			dispose: () => {
				this.onChangeListeners.delete(listener);
			},
		};
	}

	private notifyChanged(): void {
		for (const listener of this.onChangeListeners) {
			listener();
		}
	}

	getProgress(folderFsPath?: string): IndexProgress {
		const key = folderFsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!key) {
			return {
				state: 'idle',
				fileCount: 0,
				chunkCount: 0,
			};
		}

		return this.progressByFolder.get(key) ?? {
			state: 'idle',
			fileCount: 0,
			chunkCount: 0,
		};
	}

	// Создать индекс после того, как пользователь подтвердит свое согласие (запись в каталог `.gen/`)
	async enableAndIndex(folder: vscode.WorkspaceFolder): Promise<void> {
		await this.scheduleFullIndex(folder, true);
	}

	async search(query: string, maxResults: number): Promise<CodebaseSearchHit[]> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return [];
		}

		const key = folder.uri.fsPath;
		if (!(await isProjectEnabled(key))) {
			return [];
		}

		if (!this.indexed.has(key) && !this.indexing.has(key)) {
			void this.scheduleFullIndex(folder);
		}

		const manifest = await loadManifest(key);
		const ranked = searchTrigrams(manifest, query, maxResults);
		const hits: CodebaseSearchHit[] = [];

		for (const row of ranked) {
			const chunk = manifest.chunks[row.chunkId];
			if (!chunk) {
				continue;
			}

			const snippet = chunk.text.length > 400 ? `${chunk.text.slice(0, 400)}...` : chunk.text;

			hits.push({
				chunkId: chunk.id,
				path: chunk.path,
				startLine: chunk.startLine,
				endLine: chunk.endLine,
				score: row.score,
				snippet,
			});
		}

		return hits;
	}

	private async bootstrapExisting(): Promise<void> {
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			await this.maybeSchedule(folder);
		}
	}

	private async maybeSchedule(folder: vscode.WorkspaceFolder): Promise<void> {
		if (!(await isProjectEnabled(folder.uri.fsPath))) {
			return;
		}

		void this.scheduleFullIndex(folder);
	}

	private async onWorkspaceFileChange(uri: vscode.Uri): Promise<void> {
		const folder = vscode.workspace.getWorkspaceFolder(uri);
		if (!folder) {
			return;
		}

		if (!(await isProjectEnabled(folder.uri.fsPath))) {
			return;
		}

		const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
		if (!relative || relative.startsWith('.gen/')) {
			return;
		}

		void this.reindexFile(folder, relative, uri);
	}

	private async onWorkspaceFileDelete(uri: vscode.Uri): Promise<void> {
		const folder = vscode.workspace.getWorkspaceFolder(uri);
		if (!folder) {
			return;
		}

		if (!(await isProjectEnabled(folder.uri.fsPath))) {
			return;
		}

		const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
		if (!relative || relative.startsWith('.gen/')) {
			return;
		}

		void this.removeFile(folder.uri.fsPath, relative);
	}

	private setProgress(folderFsPath: string, patch: Partial<IndexProgress>): void {
		const prev = this.progressByFolder.get(folderFsPath) ?? {
			state: 'idle' as const,
			fileCount: 0,
			chunkCount: 0,
		};

		this.progressByFolder.set(folderFsPath, { ...prev, ...patch });
		this.notifyChanged();
	}

	private async scheduleFullIndex(folder: vscode.WorkspaceFolder, force = false): Promise<void> {
		const key = folder.uri.fsPath;
		if (!force && this.indexed.has(key)) {
			return;
		}

		if (this.indexing.has(key)) {
			return;
		}

		this.indexing.add(key);
		this.setProgress(key, {
			state: 'indexing',
		});

		try {
			await this.fullIndex(folder);
			this.indexed.add(key);
			const manifest = await loadManifest(key);
			this.setProgress(key, {
				state: 'ready',
				fileCount: Object.keys(manifest.files).length,
				chunkCount: Object.keys(manifest.chunks).length,
				lastError: undefined,
			});
		} catch (err) {
			this.setProgress(key, {
				state: 'error',
				lastError: err instanceof Error ? err.message : String(err),
			});
		} finally {
			this.indexing.delete(key);
			this.notifyChanged();
		}
	}

	private async fullIndex(folder: vscode.WorkspaceFolder): Promise<void> {
		const folderFsPath = folder.uri.fsPath;
		const manifest = await loadManifest(folderFsPath);
		const files = await listIndexableFiles(folder);
		const seen = new Set<string>();

		for (const file of files) {
			seen.add(file.relative);
			await this.indexOneFile(manifest, folderFsPath, file.relative, file.uri, {
				save: false,
			});
		}

		for (const relative of Object.keys(manifest.files)) {
			if (!seen.has(relative)) {
				this.dropFile(manifest, relative);
			}
		}

		rebuildManifestTrigrams(manifest);
		await saveManifest(folderFsPath, manifest);
	}

	private async reindexFile(folder: vscode.WorkspaceFolder, relative: string, uri: vscode.Uri): Promise<void> {
		const folderFsPath = folder.uri.fsPath;
		const manifest = await loadManifest(folderFsPath);
		const changed = await this.indexOneFile(manifest, folderFsPath, relative, uri, {
			save: false,
		});
		if (!changed) {
			return;
		}

		rebuildManifestTrigrams(manifest);
		await saveManifest(folderFsPath, manifest);
		this.setProgress(folderFsPath, {
			state: 'ready',
			fileCount: Object.keys(manifest.files).length,
			chunkCount: Object.keys(manifest.chunks).length,
		});
	}

	private async removeFile(folderFsPath: string, relative: string): Promise<void> {
		const manifest = await loadManifest(folderFsPath);
		if (!manifest.files[relative]) {
			return;
		}

		this.dropFile(manifest, relative);
		rebuildManifestTrigrams(manifest);
		await saveManifest(folderFsPath, manifest);
	}

	private dropFile(manifest: IndexManifest, relative: string): void {
		const record = manifest.files[relative];
		if (!record) {
			return;
		}

		for (const chunkId of record.chunkIds) {
			delete manifest.chunks[chunkId];
		}

		delete manifest.files[relative];
	}

	private async indexOneFile(
		manifest: IndexManifest,
		folderFsPath: string,
		relative: string,
		uri: vscode.Uri,
		opts: {
			save: boolean
		},
	): Promise<boolean> {
		const text = await readIndexableText(uri);
		if (text === undefined) {
			if (manifest.files[relative]) {
				this.dropFile(manifest, relative);
				if (opts.save) {
					rebuildManifestTrigrams(manifest);
					await saveManifest(folderFsPath, manifest);
				}

				return true;
			}

			return false;
		}

		const hash = contentHash(text);
		const prev = manifest.files[relative];
		if (prev?.hash === hash) {
			return false;
		}

		if (prev) {
			this.dropFile(manifest, relative);
		}

		const chunks = chunkFileContent(relative, text);
		const chunkIds: string[] = [];
		for (const chunk of chunks) {
			manifest.chunks[chunk.id] = chunk;
			chunkIds.push(chunk.id);
		}

		manifest.files[relative] = {
			hash,
			size: text.length,
			chunkIds,
		};

		if (opts.save) {
			rebuildManifestTrigrams(manifest);
			await saveManifest(folderFsPath, manifest);
		}

		return true;
	}
}

let instance: IndexManager | undefined;

export function initIndexManager(context: vscode.ExtensionContext): IndexManager {
	if (!instance) {
		instance = new IndexManager(context);
		context.subscriptions.push(instance);
	}

	return instance;
}

export function getIndexManager(): IndexManager | undefined {
	return instance;
}
