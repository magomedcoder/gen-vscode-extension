import * as vscode from 'vscode';
import { AGENT_LIMITS } from './policy';

export interface CheckpointEntry {
	uri: vscode.Uri;
	relative: string;
	kind: 'created' | 'modified';
	content?: string;
}

export class AgentCheckpoint {
	private readonly entries = new Map<string, CheckpointEntry>();
	// false - не копить снимки (snapshotEnabled выкл.): remember сразу выходит
	readonly enabled: boolean;

	constructor(enabled = true) {
		this.enabled = enabled;
	}

	get size(): number {
		return this.entries.size;
	}

	listRelatives(): string[] {
		return [...this.entries.values()].map((e) => e.relative.replace(/\\/g, '/'));
	}

	// Снимок до правки по relative path (если есть)
	peekByRelative(relative: string): CheckpointEntry | undefined {
		const needle = relative.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
		for (const entry of this.entries.values()) {
			const key = entry.relative.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
			if (key === needle) {
				return entry;
			}
		}

		return undefined;
	}

	async remember(uri: vscode.Uri, relative: string, before: string | undefined): Promise<void> {
		if (!this.enabled) {
			return;
		}

		const key = uri.toString();
		if (this.entries.has(key)) {
			return;
		}

		if (before === undefined) {
			this.entries.set(key, {
				uri,
				relative,
				kind: 'created'
			});
			return;
		}

		if (before.length > AGENT_LIMITS.maxReadBytes) {
			return;
		}

		this.entries.set(key, {
			uri,
			relative,
			kind: 'modified',
			content: before
		});
	}

	async restore(): Promise<string[]> {
		const restored: string[] = [];
		const items = [...this.entries.values()].reverse();

		for (const item of items) {
			if (item.kind === 'created') {
				try {
					await vscode.workspace.fs.delete(item.uri, {
						recursive: true,
						useTrash: true,
					});
					restored.push(item.relative);
				} catch {}
				continue;
			}

			const bytes = new TextEncoder().encode(item.content ?? '');
			const edit = new vscode.WorkspaceEdit();
			try {
				const doc = await vscode.workspace.openTextDocument(item.uri);
				const last = Math.max(0, doc.lineCount - 1);
				edit.replace(doc.uri, new vscode.Range(0, 0, last, doc.lineAt(last).text.length), item.content ?? '');
			} catch {
				edit.createFile(item.uri, {
					overwrite: true,
					contents: bytes,
				});
			}

			const ok = await vscode.workspace.applyEdit(edit);
			if (ok) {
				restored.push(item.relative);
			}
		}

		this.entries.clear();
		return restored;
	}
}
