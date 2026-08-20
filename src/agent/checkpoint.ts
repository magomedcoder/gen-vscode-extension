import * as vscode from 'vscode';
import { showConfirmDialog } from '../ui/confirmDialog';
import { AGENT_LIMITS } from './policy';

interface CheckpointEntry {
	uri: vscode.Uri;
	relative: string;
	kind: 'created' | 'modified';
	content?: string;
}

export class AgentCheckpoint {
	private readonly entries = new Map<string, CheckpointEntry>();

	get size(): number {
		return this.entries.size;
	}

	async remember(uri: vscode.Uri, relative: string, before: string | undefined): Promise<void> {
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

export async function offerCheckpointRestore(checkpoint: AgentCheckpoint): Promise<void> {
	if (checkpoint.size === 0) {
		return;
	}

	const choice = await showConfirmDialog({
		title: vscode.l10n.t('agent.checkpointOffer', checkpoint.size),
		variant: 'binary',
		applyLabel: vscode.l10n.t('agent.restoreSnapshot'),
		rejectLabel: vscode.l10n.t('comment.cancel'),
	});
	if (choice !== 'apply') {
		return;
	}

	const restored = await checkpoint.restore();
	if (restored.length === 0) {
		void vscode.window.showWarningMessage(vscode.l10n.t('agent.restoreFailed'));
		return;
	}

	void vscode.window.showInformationMessage(vscode.l10n.t('agent.restoredFiles', restored.length));
}
