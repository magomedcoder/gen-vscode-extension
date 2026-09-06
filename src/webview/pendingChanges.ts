import type { ChatUiMessage } from '../chat/protocol';

// Файл с pending-хунками (для дерева / Accept|Reject по path)
export interface PendingFileEntry {
	path: string;
	hunkCount: number;
}

// Узел дерева: папка (с children) или файл (с path)
export interface PendingTreeNode {
	// Имя сегмента (файл или папка)
	name: string;
	// Полный relative-path - только у файлов
	path?: string;
	hunkCount?: number;
	children?: PendingTreeNode[];
}

// Сводка pending-хунков по всей сессии (из messages)
export interface PendingChangesSummary {
	hunkCount: number;
	fileCount: number;
	// Уникальные пути pending-хунков (для краткого списка в UI)
	paths: string[];
	// Файлы с числом pending-хунков
	files: PendingFileEntry[];
	// Дерево по папкам из pending paths
	tree: PendingTreeNode[];
	// toolCallId с хотя бы одним pending-хунком - для acceptAll/rejectAll
	toolCallIds: string[];
}

// Нормализует разделители пути
function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

// Строит дерево папок из списка файлов
export function buildPendingTree(files: readonly PendingFileEntry[]): PendingTreeNode[] {
	const root: PendingTreeNode[] = [];

	const ensureFolder = (nodes: PendingTreeNode[], name: string): PendingTreeNode => {
		let folder = nodes.find((n) => n.children && n.name === name && !n.path);
		if (!folder) {
			folder = { name, children: [] };
			nodes.push(folder);
		}

		if (!folder.children) {
			folder.children = [];
		}

		return folder;
	};

	for (const file of files) {
		const normalized = normalizePath(file.path);
		const parts = normalized.split('/').filter(Boolean);
		if (parts.length === 0) {
			continue;
		}

		let cursor = root;
		for (let i = 0; i < parts.length - 1; i += 1) {
			const folder = ensureFolder(cursor, parts[i]);
			cursor = folder.children!;
		}

		const fileName = parts[parts.length - 1];
		const existing = cursor.find((n) => n.path === normalized);
		if (existing) {
			existing.hunkCount = (existing.hunkCount ?? 0) + file.hunkCount;
		} else {
			cursor.push({
				name: fileName,
				path: normalized,
				hunkCount: file.hunkCount,
			});
		}
	}

	const sortNodes = (nodes: PendingTreeNode[]): void => {
		nodes.sort((a, b) => {
			const aDir = Boolean(a.children);
			const bDir = Boolean(b.children);
			if (aDir !== bDir) {
				return aDir ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});
		for (const n of nodes) {
			if (n.children) {
				sortNodes(n.children);
			}
		}
	};

	sortNodes(root);
	return root;
}

// Сканирует messages: toolCalls с hunk.status === 'pending'
export function collectPendingChanges(messages: readonly ChatUiMessage[]): PendingChangesSummary {
	const toolCallIds: string[] = [];
	const hunkByPath = new Map<string, number>();
	let hunkCount = 0;

	for (const msg of messages) {
		for (const call of msg.toolCalls ?? []) {
			const pending = (call.hunks ?? []).filter((h) => h.status === 'pending');
			if (pending.length === 0) {
				continue;
			}

			toolCallIds.push(call.id);
			hunkCount += pending.length;
			for (const hunk of pending) {
				const path = hunk.path ?? call.path;
				if (!path) {
					continue;
				}
				
				const key = normalizePath(path);
				hunkByPath.set(key, (hunkByPath.get(key) ?? 0) + 1);
			}
		}
	}

	const paths = [...hunkByPath.keys()].sort((a, b) => a.localeCompare(b));
	const files: PendingFileEntry[] = paths.map((path) => ({
		path,
		hunkCount: hunkByPath.get(path) ?? 0,
	}));

	return {
		hunkCount,
		fileCount: files.length,
		paths,
		files,
		tree: buildPendingTree(files),
		toolCallIds,
	};
}
