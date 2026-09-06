import { useState } from 'react';
import type { PendingChangesSummary, PendingTreeNode } from '../pendingChanges';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

interface PendingChangesBarProps {
	summary: PendingChangesSummary;
}

function openPath(path: string): void {
	vscodeApi.postMessage({ 
		type: 'openPath', 
		path
	});
}

function reviewPath(path: string, action: 'accept' | 'reject'): void {
	vscodeApi.postMessage({ 
		type: 'reviewPendingPath', 
		path, action
	});
}

interface TreeNodeProps {
	node: PendingTreeNode;
	depth: number;
}

// Рекурсивный узел: папка (collapsible) или файл с Accept/Reject
function PendingTreeNodeView({ node, depth }: TreeNodeProps) {
	const isFolder = Boolean(node.children);
	const [open, setOpen] = useState(true);

	if (isFolder) {
		return (
			<div className="pending-changes__folder" style={{ paddingLeft: depth * 10 }}>
				<button
					type="button"
					className="pending-changes__folder-toggle"
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
				>
					<span className="pending-changes__chevron" aria-hidden>
						{open ? '▾' : '▸'}
					</span>
					<span className="pending-changes__folder-name">{node.name}/</span>
				</button>
				{open
					? node.children!.map((child) => (
						<PendingTreeNodeView
							key={child.path ?? `${node.name}/${child.name}`}
							node={child}
							depth={depth + 1}
						/>
					))
					: null}
			</div>
		);
	}

	const path = node.path!;
	return (
		<div className="pending-changes__file" style={{ paddingLeft: depth * 10 }}>
			<button
				type="button"
				className="pending-changes__path pending-changes__path--link"
				title={path}
				onClick={() => openPath(path)}
			>
				{node.name}
				{node.hunkCount && node.hunkCount > 1 ? (
					<span className="pending-changes__file-hunks">{node.hunkCount}</span>
				) : null}
			</button>
			<span className="pending-changes__file-actions">
				<button
					type="button"
					className="hunk__btn hunk__btn--accept pending-changes__file-btn"
					title={t('chat.pendingChanges.acceptFile')}
					onClick={() => reviewPath(path, 'accept')}
				>
					{t('chat.pendingChanges.acceptFile')}
				</button>
				<button
					type="button"
					className="hunk__btn hunk__btn--reject pending-changes__file-btn"
					title={t('chat.pendingChanges.rejectFile')}
					onClick={() => reviewPath(path, 'reject')}
				>
					{t('chat.pendingChanges.rejectFile')}
				</button>
			</span>
		</div>
	);
}

// Сессионная панель: дерево файлов + Accept/Reject all pending-хунков над composer
export function PendingChangesBar({ summary }: PendingChangesBarProps) {
	const { hunkCount, fileCount, tree, toolCallIds } = summary;
	const [treeOpen, setTreeOpen] = useState(true);

	const postAll = (action: 'acceptAll' | 'rejectAll') => {
		for (const toolCallId of toolCallIds) {
			vscodeApi.postMessage({ type: 'reviewDiff', toolCallId, action });
		}
	};

	return (
		<div className="pending-changes" role="status">
			<div className="pending-changes__main">
				<span className="pending-changes__title">{t('chat.pendingChanges.title')}</span>
				<span className="pending-changes__count">
					{t('chat.pendingChanges.count', hunkCount, fileCount)}
				</span>
			</div>
			{tree.length > 0 ? (
				<div className="pending-changes__tree">
					<button
						type="button"
						className="pending-changes__tree-toggle"
						aria-expanded={treeOpen}
						onClick={() => setTreeOpen((v) => !v)}
					>
						<span className="pending-changes__chevron" aria-hidden>
							{treeOpen ? '▾' : '▸'}
						</span>
						{t('chat.pendingChanges.files')}
					</button>
					{treeOpen
						? tree.map((node) => (
							<PendingTreeNodeView
								key={node.path ?? node.name}
								node={node}
								depth={0}
							/>
						))
						: null}
				</div>
			) : null}
			<span className="pending-changes__actions">
				<button
					type="button"
					className="hunk__btn hunk__btn--accept"
					onClick={() => postAll('acceptAll')}
				>
					{t('chat.pendingChanges.acceptAll')}
				</button>
				<button
					type="button"
					className="hunk__btn hunk__btn--reject"
					onClick={() => postAll('rejectAll')}
				>
					{t('chat.pendingChanges.rejectAll')}
				</button>
			</span>
		</div>
	);
}
