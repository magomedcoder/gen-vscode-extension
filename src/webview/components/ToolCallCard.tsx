import { useState } from 'react';
import type { DiffHunkPayload, ToolCallUi } from '../../chat/protocol';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

const RESULT_PREVIEW = 500;

function statusLabel(status: ToolCallUi['status']): string {
	if (status === 'pending') {
		return t('chat.tool.status.pending');
	}

	if (status === 'ok') {
		return t('chat.tool.status.ok');
	}

	if (status === 'denied') {
		return t('chat.tool.status.denied');
	}

	return t('chat.tool.status.error');
}

function DiffLinePreview({ preview }: { preview: string }) {
	return (
		<pre className="tool-card__block tool-card__diff">
			{preview.split('\n').map((line, i) => {
				const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
				return (<span key={i} className={`diff-line diff-line--${kind}`}>{line || ' '}</span>);
			})}
		</pre>
	);
}

function hunkStatusLabel(status: DiffHunkPayload['status']): string {
	if (status === 'accepted') {
		return t('chat.hunk.accepted');
	}

	if (status === 'rejected') {
		return t('chat.hunk.rejected');
	}

	return '';
}

function HunkReview({ callId, hunk }: { callId: string; hunk: DiffHunkPayload }) {
	const pending = hunk.status === 'pending';
	return (
		<div className={`hunk hunk--${hunk.status}`}>
			<div className="hunk__header">
				<span className="hunk__meta">
					{hunk.path ? <span className="hunk__path">{hunk.path}</span> : null}
					<span className="hunk__lines">@{hunk.newStart}</span>
					{hunk.status !== 'pending' ? <span className="hunk__status">{hunkStatusLabel(hunk.status)}</span> : null}
				</span>
				{pending ? (
					<span className="hunk__actions">
						<button
							type="button"
							className="hunk__btn hunk__btn--accept"
							onClick={() => vscodeApi.postMessage({
								type: 'reviewHunk',
								toolCallId: callId,
								hunkId: hunk.id,
								action: 'accept',
							})}
						>
							{t('chat.hunk.accept')}
						</button>
						<button
							type="button"
							className="hunk__btn hunk__btn--reject"
							onClick={() => vscodeApi.postMessage({
								type: 'reviewHunk',
								toolCallId: callId,
								hunkId: hunk.id,
								action: 'reject',
							})}
						>
							{t('chat.hunk.reject')}
						</button>
					</span>
				) : null}
			</div>
			<DiffLinePreview preview={hunk.preview} />
		</div>
	);
}

export function ToolCallCard({ call }: { call: ToolCallUi }) {
	const [expanded, setExpanded] = useState(false);
	const result = call.result ?? '';
	const truncated = !expanded && result.length > RESULT_PREVIEW;
	const shown = truncated ? `${result.slice(0, RESULT_PREVIEW)}\n...` : result;
	const hunks = call.hunks ?? [];
	const pendingCount = hunks.filter((h) => h.status === 'pending').length;
	const showHunks = hunks.length > 0;

	return (
		<details className={`tool-card tool-card--${call.status}`} open={call.status !== 'ok' || pendingCount > 0}>
			<summary>
				<span className="tool-card__title">
					<span className="tool-card__name">{call.name}</span>
					{call.path ? <span className="tool-card__path">{call.path}</span> : null}
				</span>
				<span className="tool-card__status">{statusLabel(call.status)}</span>
			</summary>
			{showHunks ? (
				<div className="hunk-list">
					{pendingCount > 0 ? (
						<div className="hunk-list__toolbar">
							<button
								type="button"
								className="hunk__btn hunk__btn--accept"
								onClick={() => vscodeApi.postMessage({
									type: 'reviewDiff',
									toolCallId: call.id,
									action: 'acceptAll',
								})}
							>
								{t('chat.hunk.acceptAll')}
							</button>
							<button
								type="button"
								className="hunk__btn hunk__btn--reject"
								onClick={() => vscodeApi.postMessage({
									type: 'reviewDiff',
									toolCallId: call.id,
									action: 'rejectAll',
								})}
							>
								{t('chat.hunk.rejectAll')}
							</button>
						</div>
					) : null}
					{hunks.map((hunk) => (
						<HunkReview key={hunk.id} callId={call.id} hunk={hunk} />
					))}
				</div>
			) : call.diff ? (
				<DiffLinePreview preview={call.diff} />
			) : null}
			{call.arguments && !call.diff && !showHunks ? (<pre className="tool-card__block"><code>{call.arguments}</code></pre>) : null}
			{result ? (<pre className="tool-card__block tool-card__block--result"><code>{shown}</code></pre>) : null}
			{result.length > RESULT_PREVIEW ? (
				<button
					className="tool-card__more"
					type="button"
					onClick={(event) => {
						event.preventDefault();
						setExpanded((v) => !v);
					}}
				>
					{expanded ? t('chat.tool.collapse') : t('chat.tool.expand')}
				</button>
			) : null}
		</details>
	);
}
