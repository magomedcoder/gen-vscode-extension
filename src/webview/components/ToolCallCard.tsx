import type { ToolCallUi } from '../../chat/protocol';

export function ToolCallCard({ call }: { call: ToolCallUi }) {
	const statusLabel = call.status === 'pending' ? 'выполняется...' : call.status === 'ok'  ? 'ok' : call.status === 'denied' ? 'отклонено' : 'ошибка';

	return (
		<details className={`tool-card tool-card--${call.status}`} open={call.status !== 'ok'}>
			<summary>
				<span className="tool-card__name">{call.name}</span>
				<span className="tool-card__status">{statusLabel}</span>
			</summary>
			{call.arguments ? (<pre className="tool-card__block"><code>{call.arguments}</code></pre>) : null}
			{call.result !== undefined ? (<pre className="tool-card__block tool-card__block--result"><code>{call.result}</code></pre>) : null}
		</details>
	);
}
