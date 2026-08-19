import { useEffect, useRef } from 'react';
import type { ChatUiMessage } from '../../chat/protocol';
import { ToolCallCard } from './ToolCallCard';
import { MarkdownMessage } from './MarkdownMessage';
import { TokenMeter } from './TokenMeter';

interface MessageListProps {
	messages: ChatUiMessage[];
	busy: boolean;
}

const STICK_THRESHOLD_PX = 80;

export function MessageList({ messages, busy }: MessageListProps) {
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
			{messages.length === 0 
				? (<div className="msg msg--hint">Напишите сообщение. В режиме Агент модель может вызывать инструменты. Выделение в редакторе уйдёт в контекст.</div>) 
				: (messages.filter((msg) => {
					if (msg.role === 'tool') {
						return false;
					}

					if (msg.role === 'assistant' && !msg.content && !msg.toolCalls?.length && !busy) {
						return false;
					}

					return true;
				}).map((msg) => (
					<div key={msg.id} className={`msg msg--${msg.role}`}>
						{msg.role === 'assistant' && msg.content 
							? (<MarkdownMessage content={msg.content} />)
							: msg.role === 'assistant' && busy && !msg.toolCalls?.length 
								? (<span className="msg__typing">гоняю байты...</span>) 
								: msg.role === 'assistant' ? null : (msg.content)}
						{msg.toolCalls?.length ? (<div className="tool-calls">{msg.toolCalls.map((call) => (<ToolCallCard key={call.id} call={call} />))}</div>) : null}
						{msg.role === 'assistant' ? <TokenMeter usage={msg.usage} /> : null}
					</div>
				))
			)}
		</div>
	);
}
