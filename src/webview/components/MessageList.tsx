import { useEffect, useRef } from 'react';
import type { ChatUiMessage } from '../../chat/protocol';
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
				<div className="msg msg--hint">Напишите сообщение. Выделение в редакторе уйдёт в контекст.</div>
			) : (
				messages.map((msg) => (
					<div key={msg.id} className={`msg msg--${msg.role}`}>
						{msg.role === 'assistant' 
						? (<MarkdownMessage content={msg.content} />) 
						: (msg.content)}
					</div>
				))
			)}
		</div>
	);
}
