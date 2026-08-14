import { useEffect, useRef } from 'react';
import type { ChatUiMessage } from '../../chat/protocol';

interface MessageListProps {
	messages: ChatUiMessage[];
}

export function MessageList({ messages }: MessageListProps) {
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = listRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, [messages]);

	return (
		<div className="messages" ref={listRef}>
			{messages.length === 0 ? (
				<div className="msg msg--hint">Напишите сообщение. Выделение в редакторе уйдёт в контекст.</div>
			) : (
				messages.map((msg) => (
					<div key={msg.id} className={`msg msg--${msg.role}`}>{msg.content}</div>
				))
			)}
		</div>
	);
}
