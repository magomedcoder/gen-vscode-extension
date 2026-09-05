import { useEffect, useRef, useState } from 'react';
import type { ChatUiMessage } from '../../chat/protocol';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';
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
	const [editingId, setEditingId] = useState<string | undefined>();
	const [draft, setDraft] = useState('');

	useEffect(() => {
		if (busy && editingId) {
			setEditingId(undefined);
			setDraft('');
		}
	}, [busy, editingId]);

	useEffect(() => {
		if (!editingId) {
			return;
		}

		const stillThere = messages.some((msg) => msg.id === editingId && msg.role === 'user');
		if (!stillThere) {
			setEditingId(undefined);
			setDraft('');
		}
	}, [messages, editingId]);

	useEffect(() => {
		const el = listRef.current;
		if (!el || !stickToBottom.current) {
			return;
		}

		el.scrollTop = el.scrollHeight;
	}, [messages]);

	const startEdit = (msg: ChatUiMessage) => {
		setEditingId(msg.id);
		setDraft(msg.content);
		stickToBottom.current = false;
	};

	const cancelEdit = () => {
		setEditingId(undefined);
		setDraft('');
	};

	const saveEdit = () => {
		if (!editingId || !draft.trim()) {
			return;
		}

		vscodeApi.postMessage({
			type: 'editMessage',
			id: editingId,
			content: draft,
		});
		setEditingId(undefined);
		setDraft('');
	};

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
				? (<div className="msg msg--hint">{t('chat.messages.emptyHint')}</div>)
				: (messages.filter((msg) => {
					if (msg.role === 'tool') {
						return false;
					}

					if (msg.role === 'assistant' && !msg.content && !msg.toolCalls?.length && !busy) {
						return false;
					}

					return true;
				}).map((msg) => {
					const isEditing = msg.role === 'user' && editingId === msg.id;
					const canEdit = !busy && !editingId && msg.role === 'user' && Boolean(msg.content.trim());
					const canFork = !busy && (msg.role === 'user' || msg.role === 'assistant') && Boolean(msg.id);

					return (
						<div key={msg.id} className={`msg msg--${msg.role}${isEditing ? ' msg--editing' : ''}`}>
							{isEditing ? (
								<div className="msg-edit">
									<textarea
										className="msg-edit__input"
										rows={6}
										value={draft}
										autoFocus
										onChange={(e) => setDraft(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === 'Escape') {
												e.preventDefault();
												cancelEdit();
											}

											if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
												e.preventDefault();
												saveEdit();
											}
										}}
									/>
									<div className="msg-edit__actions">
										<button className="btn btn--secondary" type="button" onClick={cancelEdit}>
											{t('chat.messages.editCancel')}
										</button>
										<button
											className="btn"
											type="button"
											disabled={!draft.trim()}
											onClick={saveEdit}
										>
											{t('chat.messages.editSave')}
										</button>
									</div>
								</div>
							) : msg.role === 'assistant' && msg.content
								? (<MarkdownMessage content={msg.content} />)
								: msg.role === 'assistant' && busy && !msg.toolCalls?.length
									? (<span className="msg__typing">{t('chat.messages.typing')}</span>)
									: msg.role === 'assistant' ? null : (
										<>
											<div className="msg__body">{msg.content}</div>
											{canEdit || canFork ? (
												<div className="msg__meta">
													{canEdit ? (
														<button
															type="button"
															className="msg__edit-btn"
															onClick={() => startEdit(msg)}
														>
															{t('chat.messages.edit')}
														</button>
													) : null}
													{canFork ? (
														<button
															type="button"
															className="msg__edit-btn"
															onClick={() => vscodeApi.postMessage({ type: 'forkSession', messageId: msg.id })}
														>
															{t('chat.messages.fork')}
														</button>
													) : null}
												</div>
											) : null}
										</>
									)}
							{!isEditing && msg.toolCalls?.length ? (
								<div className="tool-calls">{msg.toolCalls.map((call) => (<ToolCallCard key={call.id} call={call} />))}</div>
							) : null}
							{msg.role === 'assistant' && !isEditing ? (
								<div className="msg__meta">
									<TokenMeter usage={msg.usage} />
									{canFork ? (
										<button
											type="button"
											className="msg__edit-btn"
											onClick={() => vscodeApi.postMessage({ type: 'forkSession', messageId: msg.id })}
										>
											{t('chat.messages.fork')}
										</button>
									) : null}
								</div>
							) : null}
						</div>
					);
				})
			)}
		</div>
	);
}
