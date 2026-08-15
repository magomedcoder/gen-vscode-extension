import { useEffect, useRef } from 'react';
import type { ChatUiMessage } from '../../chat/protocol';
import { ToolCallCard } from './ToolCallCard';
import { MarkdownMessage } from './MarkdownMessage';

interface MessageListProps {
	messages: ChatUiMessage[];
}

const STICK_THRESHOLD_PX = 80;

export function MessageList({ messages }: MessageListProps) {
	const listRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);

	useEffect(() => {
		const el = listRef.current;
		if (!el || !stickToBottom.current) {
			return;
		}
		el.scrollTop = el.scrollHeight;
	}, [messages]);

	return (
		<div
			className="messages"
			ref={listRef}
			onScroll={() => {
				const el = listRef.current;
				if (!el) {
					return;
				}

				stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
			}}
		>
			{messages.length === 0 ? (
				<div className="msg msg--hint">
					Напишите сообщение. В режиме Агент модель может вызывать инструменты. Выделение в редакторе уйдёт в контекст.
				</div>
			) : (
				messages.filter((msg) => msg.role !== 'tool').map((msg) => (
					<div key={msg.id} className={`msg msg--${msg.role}`}>
						{msg.role === 'assistant' && msg.content ? (
							<MarkdownMessage content={msg.content} />
						) : msg.role === 'assistant' ? null : (msg.content)}
						{msg.toolCalls?.length ? (
							<div className="tool-calls">
								{msg.toolCalls.map((call) => (<ToolCallCard key={call.id} call={call} />))}
							</div>
						) : null}
					</div>
				))
			)}
		</div>
	);
}
