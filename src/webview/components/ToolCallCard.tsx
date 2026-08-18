import { useState } from 'react';
import type { ToolCallUi } from '../../chat/protocol';

const RESULT_PREVIEW = 500;

function statusLabel(status: ToolCallUi['status']): string {
	if (status === 'pending') {
		return 'выполняется...';
	}

	if (status === 'ok') {
		return 'ok';
	}

	if (status === 'denied') {
		return 'отклонено';
	}

	return 'ошибка';
}

function DiffPreview({ diff }: { diff: string }) {
	return (
		<pre className="tool-card__block tool-card__diff">
			{diff.split('\n').map((line, i) => {
				const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
				return (<span key={i} className={`diff-line diff-line--${kind}`}>{line || ' '}</span>);
			})}
		</pre>
	);
}

export function ToolCallCard({ call }: { call: ToolCallUi }) {
	const [expanded, setExpanded] = useState(false);
	const result = call.result ?? '';
	const truncated = !expanded && result.length > RESULT_PREVIEW;
	const shown = truncated ? `${result.slice(0, RESULT_PREVIEW)}\n...` : result;

	return (
		<details className={`tool-card tool-card--${call.status}`} open={call.status !== 'ok'}>
			<summary>
				<span className="tool-card__title">
					<span className="tool-card__name">{call.name}</span>
					{call.path ? <span className="tool-card__path">{call.path}</span> : null}
				</span>
				<span className="tool-card__status">{statusLabel(call.status)}</span>
			</summary>
			{call.diff ? <DiffPreview diff={call.diff} /> : null}
			{call.arguments && !call.diff ? (<pre className="tool-card__block"><code>{call.arguments}</code></pre>) : null}
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
					{expanded ? 'Свернуть' : 'Показать полностью'}
				</button>
			) : null}
		</details>
	);
}
