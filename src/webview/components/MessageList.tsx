import { useEffect, useRef, useState } from 'react';
import type { ThinkingDisplay } from '../../core/config/types';
import type { ChatUiMessage, PendingConfirm, PendingQuestion } from '../../features/chat/protocol';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';
import { ToolCallCard, type ToolDetailsMode } from './ToolCallCard';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownMessage } from './MarkdownMessage';
import { TokenMeter } from './TokenMeter';
import { ConfirmCard } from './ConfirmCard';
import { QuestionCard } from './QuestionCard';

interface MessageListProps {
	messages: ChatUiMessage[];
	busy: boolean;
	detailsExpanded?: boolean;
	thinkingDisplay?: ThinkingDisplay;
	pendingConfirm?: PendingConfirm;
	pendingQuestion?: PendingQuestion;
}

const STICK_THRESHOLD_PX = 80;

export function MessageList({
	messages,
	busy,
	detailsExpanded = true,
	thinkingDisplay = 'collapsed',
	pendingConfirm,
	pendingQuestion,
}: MessageListProps) {
	const detailsMode: ToolDetailsMode = detailsExpanded ? 'full' : 'compact';
	const listRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	const [editingId, setEditingId] = useState<string | undefined>();
	const [draft, setDraft] = useState('');
	const [revertFiles, setRevertFiles] = useState(false);

	useEffect(() => {
		if (busy && editingId) {
			setEditingId(undefined);
			setDraft('');
			setRevertFiles(false);
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
			setRevertFiles(false);
		}
	}, [messages, editingId]);

	useEffect(() => {
		const el = listRef.current;
		if (!el || !stickToBottom.current) {
			return;
		}

		el.scrollTop = el.scrollHeight;
	}, [messages, pendingConfirm, pendingQuestion]);

	const startEdit = (msg: ChatUiMessage) => {
		setEditingId(msg.id);
		setDraft(msg.content);
		setRevertFiles(false);
		stickToBottom.current = false;
	};

	const cancelEdit = () => {
		setEditingId(undefined);
		setDraft('');
		setRevertFiles(false);
	};

	const saveEdit = () => {
		if (!editingId || !draft.trim()) {
			return;
		}

		vscodeApi.postMessage({
			type: 'editMessage',
			id: editingId,
			content: draft,
			revertFiles: revertFiles || undefined,
		});
		setEditingId(undefined);
		setDraft('');
		setRevertFiles(false);
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

					if (msg.role === 'assistant' && !msg.content && !msg.thinking?.trim() && !msg.toolCalls?.length && !busy) {
						return false;
					}

					return true;
				}).map((msg) => {
					const isEditing = msg.role === 'user' && editingId === msg.id;
					const canEdit = !busy && !editingId && msg.role === 'user' && Boolean(msg.content.trim());
					const canFork = !busy && (msg.role === 'user' || msg.role === 'assistant') && Boolean(msg.id);
					const showThinking = msg.role === 'assistant' && Boolean(msg.thinking?.trim());

					return (
						<div key={msg.id} className={`msg msg--${msg.role}${isEditing ? ' msg--editing' : ''}`}>
							{!isEditing && showThinking ? (
								<ThinkingBlock thinking={msg.thinking!} display={thinkingDisplay} />
							) : null}
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
									<label className="msg-edit__revert" title={t('chat.edit.revertFilesHint')}>
										<input
											type="checkbox"
											checked={revertFiles}
											onChange={(e) => setRevertFiles(e.target.checked)}
										/>
										<span className="msg-edit__revert-text">
											<span className="msg-edit__revert-label">{t('chat.edit.revertFiles')}</span>
											<span className="msg-edit__revert-hint">{t('chat.edit.revertFilesHint')}</span>
										</span>
									</label>
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
								: msg.role === 'assistant' && busy && !msg.toolCalls?.length && !msg.thinking?.trim()
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
								<div className="tool-calls">
									{msg.toolCalls.map((call) => (<ToolCallCard key={call.id} call={call} detailsMode={detailsMode} />))}
								</div>
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
			{pendingConfirm ? (
				<div className="msg msg--confirm"><ConfirmCard confirm={pendingConfirm} /></div>
			) : null}
			{pendingQuestion ? (
				<div className="msg msg--confirm"><QuestionCard question={pendingQuestion} /></div>
			) : null}
		</div>
	);
}
