import * as vscode from 'vscode';
import { getSettings } from '../config/settings';
import { deniedDirectoryExcludeGlob } from '../agent/policy';
import type { MentionKind } from './mentions';

export interface MentionSuggestion {
	kind: MentionKind;
	label: string;
	insert: string;
	detail?: string;
}

function kindTemplates(): Array<{
	kind: MentionKind;
	label: string;
	insert: string;
	detail: string;
}> {
	return [
		{
			kind: 'file',
			label: '@file',
			insert: '@file ',
			detail: vscode.l10n.t('chat.mention.detail.file')
		},
		{
			kind: 'folder',
			label: '@folder',
			insert: '@folder ',
			detail: vscode.l10n.t('chat.mention.detail.folder')
		},
		{
			kind: 'codebase',
			label: '@codebase',
			insert: '@codebase ',
			detail: vscode.l10n.t('chat.mention.detail.codebase')
		},
		{
			kind: 'git',
			label: '@git',
			insert: '@git ',
			detail: vscode.l10n.t('chat.mention.detail.git')
		},
		{
			kind: 'branch_diff',
			label: '@branch_diff',
			insert: '@branch_diff',
			detail: vscode.l10n.t('chat.mention.detail.branchDiff')
		},
		{
			kind: 'rules',
			label: '@rules',
			insert: '@rules',
			detail: vscode.l10n.t('chat.mention.detail.rules')
		},
		{
			kind: 'link',
			label: '@link',
			insert: '@link ',
			detail: vscode.l10n.t('chat.mention.detail.link')
		},
	];
}

export async function suggestMentions(query: string): Promise<MentionSuggestion[]> {
	const q = query.trim().toLowerCase();
	const prefix = q.replace(/^@/, '');

	const kindNames = ['file', 'folder', 'codebase', 'git', 'branch_diff', 'rules', 'link'];
	if (!prefix || kindNames.some((k) => k.startsWith(prefix) || prefix.startsWith(k))) {
		const kindHits = kindTemplates().filter((k) => k.kind.startsWith(prefix) || prefix.length === 0 || prefix.startsWith(k.kind));
		if (!prefix.includes(' ') && !/[./]/.test(prefix) || kindHits.some((k) => k.kind === 'branch_diff' || k.kind === 'rules')) {
			if (!prefix.includes('/') && !prefix.includes('.')) {
				const hits = kindTemplates().filter((k) => !prefix || k.kind.startsWith(prefix) || k.kind.includes(prefix));
				if (hits.length && !prefix.includes(' ')) {
					return hits.map((k) => ({
						kind: k.kind,
						label: k.label,
						insert: k.insert,
						detail: k.detail,
					}));
				}
			}
		}
	}

	if (prefix.startsWith('git')) {
		return [{
			kind: 'git',
			label: '@git HEAD',
			insert: '@git HEAD ',
			detail: vscode.l10n.t('chat.mention.detail.gitShow'),
		}];
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const pathQuery = prefix.replace(/^(file|folder|codebase|git|link)\s+/, '')
		.replace(/^(file|folder|codebase|git|link):/, '')
		.trim();

	const kind: 'file' | 'folder' = prefix.startsWith('folder') ? 'folder' : 'file';

	const exclude = deniedDirectoryExcludeGlob(getSettings().deniedPaths) ?? '**/{.gen,node_modules,.git}/**';
	const glob = pathQuery ? `**/*${pathQuery.replace(/[^\w./-]/g, '')}*` : '**/*';

	const uris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, glob),
		exclude,
		30,
	);

	const seen = new Set<string>();
	const out: MentionSuggestion[] = [];

	for (const uri of uris) {
		const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
		if (!relative || seen.has(relative)) {
			continue;
		}

		seen.add(relative);
		if (kind === 'folder') {
			const dir = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : relative;
			if (!dir || seen.has(`dir:${dir}`)) {
				continue;
			}

			seen.add(`dir:${dir}`);
			out.push({
				kind: 'folder',
				label: dir,
				insert: `@folder ${dir} `,
				detail: vscode.l10n.t('chat.mention.kind.folder'),
			});
		} else {
			out.push({
				kind: 'file',
				label: relative,
				insert: `@file ${relative} `,
				detail: vscode.l10n.t('chat.mention.kind.file'),
			});
		}

		if (out.length >= 12) {
			break;
		}
	}

	return out;
}
