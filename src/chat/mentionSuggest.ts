import * as vscode from 'vscode';
import { getSettings } from '../config/settings';
import { deniedDirectoryExcludeGlob } from '../agent/policy';

export interface MentionSuggestion {
	kind: 'file' | 'folder' | 'codebase';
	label: string;
	insert: string;
	detail?: string;
}

const KINDS: Array<{ 
	kind: 'file' | 'folder' | 'codebase'; 
	label: string; 
	insert: string; 
	detail: string 
}> = [
	{ 
		kind: 'file', 
		label: '@file', 
		insert: '@file ', 
		detail: 'Прикрепить файл' 
	},
	{ 
		kind: 'folder', 
		label: '@folder', 
		insert: '@folder ', 
		detail: 'Прикрепить папку' 
	},
	{ 
		kind: 'codebase', 
		label: '@codebase', 
		insert: '@codebase ', 
		detail: 'Поиск по индексу' 
	},
];

export async function suggestMentions(query: string): Promise<MentionSuggestion[]> {
	const q = query.trim().toLowerCase();
	const prefix = q.replace(/^@/, '');

	if (!prefix || 'file'.startsWith(prefix) || 'folder'.startsWith(prefix) || 'codebase'.startsWith(prefix)) {
		const kindHits = KINDS.filter((k) => k.kind.startsWith(prefix) || prefix.length === 0);
		if (prefix.length === 0 || kindHits.length > 0 && !prefix.includes('/') && !prefix.includes('.')) {
			if (!prefix.includes(' ') && !/[./]/.test(prefix)) {
				return kindHits.map((k) => ({
					kind: k.kind,
					label: k.label,
					insert: k.insert,
					detail: k.detail,
				}));
			}
		}
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const pathQuery = prefix.replace(/^(file|folder|codebase)\s+/, '').replace(/^(file|folder|codebase):/, '').trim();

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
				detail: 'папка',
			});
		} else {
			out.push({
				kind: 'file',
				label: relative,
				insert: `@file ${relative} `,
				detail: 'файл',
			});
		}

		if (out.length >= 12) {
			break;
		}
	}

	return out;
}
