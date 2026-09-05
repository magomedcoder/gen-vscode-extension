import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type SubmitEvent } from 'react';
import type { ChatMode, MentionSuggestion } from '../../chat/protocol';
import { activeSlashQuery, filterSlashCommands } from '../../chat/slashCommands';
import type { SlashCommand } from '../../chat/slashCommands';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

interface ComposerProps {
	busy: boolean;
	busyDetail?: string;
	queuedCount: number;
	mode: ChatMode;
	customSlashCommands?: SlashCommand[];
}

interface ContextChip {
	id: string;
	kind: MentionSuggestion['kind'];
	label: string;
	insert: string;
}

type SuggestKind = 'mention' | 'slash';

function activeMentionQuery(text: string, cursor: number): { start: number; query: string } | undefined {
	const before = text.slice(0, cursor);
	const at = before.lastIndexOf('@');
	if (at < 0) {
		return undefined;
	}

	if (at > 0 && !/\s/.test(before[at - 1] ?? ' ')) {
		return undefined;
	}

	const fragment = before.slice(at + 1);
	if (/\s/.test(fragment) && !/^(file|folder|codebase|git|link|docs|agent)\s+\S*$/i.test(fragment)) {
		return undefined;
	}

	return { start: at, query: fragment };
}

interface PendingImage {
	id: string;
	name: string;
	mimeType: string;
	base64: string;
}

function chipFromSuggestion(item: MentionSuggestion): ContextChip {
	return {
		id: item.insert.trim(),
		kind: item.kind,
		label: item.label,
		insert: item.insert.trim(),
	};
}

function slashDetail(cmd: SlashCommand): string {
	if (cmd.detail) {
		return cmd.detail;
	}
	return cmd.detailKey ? t(cmd.detailKey) : '';
}

export function Composer({ busy, busyDetail, queuedCount, mode, customSlashCommands = [] }: ComposerProps) {
	const [draft, setDraft] = useState('');
	const [chips, setChips] = useState<ContextChip[]>([]);
	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
	const [slashSuggestions, setSlashSuggestions] = useState<SlashCommand[]>([]);
	const [suggestKind, setSuggestKind] = useState<SuggestKind>('mention');
	const [suggestIndex, setSuggestIndex] = useState(0);
	const requestId = useRef(0);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const setMode = (next: ChatMode) => {
		if (next === mode || busy) {
			return;
		}

		vscodeApi.postMessage({
			type: 'setChatMode',
			mode: next,
		});
	};

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const data = event.data;
			if (!data || data.type !== 'mentionSuggestions') {
				return;
			}

			if (data.requestId !== requestId.current) {
				return;
			}

			setSuggestions(data.items ?? []);
			setSuggestKind('mention');
			setSuggestIndex(0);
		};

		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	const clearSuggest = () => {
		setSuggestions([]);
		setSlashSuggestions([]);
	};

	const requestSuggestions = (text: string, cursor: number) => {
		const slash = activeSlashQuery(text, cursor);
		if (slash) {
			const items = filterSlashCommands(slash.query, customSlashCommands);
			setSlashSuggestions(items);
			setSuggestions([]);
			setSuggestKind('slash');
			setSuggestIndex(0);
			return;
		}

		setSlashSuggestions([]);
		const active = activeMentionQuery(text, cursor);
		if (!active) {
			setSuggestions([]);
			return;
		}

		const id = requestId.current + 1;
		requestId.current = id;
		setSuggestKind('mention');
		vscodeApi.postMessage({
			type: 'mentionSuggest',
			requestId: id,
			query: active.query,
		});
	};

	const applyMentionSuggestion = (item: MentionSuggestion) => {
		const el = textareaRef.current;
		const cursor = el?.selectionStart ?? draft.length;
		const active = activeMentionQuery(draft, cursor);
		if (!active) {
			return;
		}

		const chip = chipFromSuggestion(item);
		setChips((prev) => (prev.some((c) => c.id === chip.id) ? prev : [...prev, chip]));

		const next = `${draft.slice(0, active.start)}${draft.slice(cursor)}`.replace(/\s{2,}/g, ' ');
		setDraft(next);
		clearSuggest();
		requestAnimationFrame(() => {
			el?.focus();
			el?.setSelectionRange(active.start, active.start);
		});
	};

	const applySlashSuggestion = (cmd: SlashCommand) => {
		setDraft(`/${cmd.name}`);
		clearSuggest();
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			el?.focus();
			const pos = cmd.name.length + 1;
			el?.setSelectionRange(pos, pos);
		});
	};

	const removeChip = (id: string) => {
		setChips((prev) => prev.filter((c) => c.id !== id));
	};

	const removePendingImage = (id: string) => {
		setPendingImages((prev) => prev.filter((p) => p.id !== id));
	};

	const addImageFile = (file: File) => {
		if (!file.type.startsWith('image/')) {
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? '');
			const comma = result.indexOf(',');
			const base64 = comma >= 0 ? result.slice(comma + 1) : result;
			if (!base64) {
				return;
			}

			const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			setPendingImages((prev) => [
				...prev,
				{
					id,
					name: file.name || 'image.png',
					mimeType: file.type || 'image/png',
					base64,
				},
			]);
		};
		reader.readAsDataURL(file);
	};

	const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const items = event.clipboardData?.items;
		if (!items) {
			return;
		}

		let handled = false;
		for (const item of Array.from(items)) {
			if (item.kind === 'file' && item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file) {
					addImageFile(file);
					handled = true;
				}
			}
		}

		if (handled) {
			event.preventDefault();
		}
	};

	const onDrop = (event: DragEvent<HTMLTextAreaElement>) => {
		event.preventDefault();
		const files = event.dataTransfer?.files;
		if (!files?.length) {
			return;
		}
		
		for (const file of Array.from(files)) {
			addImageFile(file);
		}
	};

	const onDragOver = (event: DragEvent<HTMLTextAreaElement>) => {
		if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
			event.preventDefault();
		}
	};

	const submit = () => {
		const question = draft.trim();
		const prefix = chips.map((c) => c.insert).join(' ').trim();
		const text = [prefix, question].filter(Boolean).join(' ').trim();
		if (!text && pendingImages.length === 0) {
			return;
		}

		const images = pendingImages.map((p) => ({
			name: p.name,
			mimeType: p.mimeType,
			base64: p.base64,
		}));
		setDraft('');
		setChips([]);
		setPendingImages([]);
		clearSuggest();
		vscodeApi.postMessage({
			type: 'send',
			text,
			images: images.length ? images : undefined,
		});
	};

	const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		submit();
	};

	const menuOpen = (suggestKind === 'mention' && suggestions.length > 0) || (suggestKind === 'slash' && slashSuggestions.length > 0);
	const menuLen = suggestKind === 'slash' ? slashSuggestions.length : suggestions.length;

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (menuOpen) {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				setSuggestIndex((i) => (i + 1) % menuLen);
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				setSuggestIndex((i) => (i - 1 + menuLen) % menuLen);
				return;
			}

			if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				if (suggestKind === 'slash') {
					applySlashSuggestion(slashSuggestions[suggestIndex] ?? slashSuggestions[0]!);
				} else {
					applyMentionSuggestion(suggestions[suggestIndex] ?? suggestions[0]!);
				}
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				clearSuggest();
				return;
			}
		}

		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			submit();
			return;
		}

		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	};

	const canSend = Boolean(draft.trim()) || chips.length > 0 || pendingImages.length > 0;
	const specialMode = mode === 'debug' || mode === 'design' || mode === 'plan' || mode === 'multitask';

	return (
		<form className="composer" onSubmit={onSubmit}>
			<div className="composer__box">
				{suggestKind === 'slash' && slashSuggestions.length > 0 ? (
					<ul className="mention-menu" role="listbox" aria-label={t('chat.composer.slashAria')}>
						{slashSuggestions.map((item, i) => (
							<li key={item.name}>
								<button
									type="button"
									className={`mention-menu__item${i === suggestIndex ? ' mention-menu__item--active' : ''}`}
									onMouseDown={(e) => {
										e.preventDefault();
										applySlashSuggestion(item);
									}}
								>
									<span className="mention-menu__label">/{item.name}</span>
									<span className="mention-menu__detail">{slashDetail(item)}</span>
								</button>
							</li>
						))}
					</ul>
				) : null}
				{suggestKind === 'mention' && suggestions.length > 0 ? (
					<ul className="mention-menu" role="listbox">
						{suggestions.map((item, i) => (
							<li key={`${item.insert}-${i}`}>
								<button
									type="button"
									className={`mention-menu__item${i === suggestIndex ? ' mention-menu__item--active' : ''}`}
									onMouseDown={(e) => {
										e.preventDefault();
										applyMentionSuggestion(item);
									}}
								>
									<span className="mention-menu__label">{item.label}</span>
									{item.detail ? <span className="mention-menu__detail">{item.detail}</span> : null}
								</button>
							</li>
						))}
					</ul>
				) : null}
				{chips.length > 0 ? (
					<ul className="composer-chips" aria-label={t('chat.composer.chipsAria')}>
						{chips.map((chip) => (
							<li key={chip.id} className={`composer-chip composer-chip--${chip.kind}`}>
								<span className="composer-chip__kind">@{chip.kind}</span>
								<span className="composer-chip__label" title={chip.label}>{chip.label}</span>
								<button
									type="button"
									className="composer-chip__remove"
									aria-label={t('chat.composer.removeChip', chip.label)}
									onClick={() => removeChip(chip.id)}
								>
									*
								</button>
							</li>
						))}
					</ul>
				) : null}
				{pendingImages.length > 0 ? (
					<ul className="composer-chips" aria-label={t('chat.composer.imagesAria')}>
						{pendingImages.map((img) => (
							<li key={img.id} className="composer-chip composer-chip--image">
								<span className="composer-chip__kind">img</span>
								<span className="composer-chip__label" title={img.name}>{img.name}</span>
								<button
									type="button"
									className="composer-chip__remove"
									aria-label={t('chat.composer.removeChip', img.name)}
									onClick={() => removePendingImage(img.id)}
								>
									*
								</button>
							</li>
						))}
					</ul>
				) : null}
				{busyDetail ? (
					<div className="composer-queue composer-queue--retry" role="status">
						{busyDetail}
					</div>
				) : null}
				{queuedCount > 0 ? (
					<div className="composer-queue" role="status">
						{t('chat.composer.queued', queuedCount)}
					</div>
				) : null}
				<textarea
					ref={textareaRef}
					className="composer__input"
					rows={2}
					value={draft}
					placeholder={busy ? t('chat.composer.placeholderBusy') : t('chat.composer.placeholder')}
					onChange={(e) => {
						const next = e.target.value;
						setDraft(next);
						requestSuggestions(next, e.target.selectionStart);
					}}
					onKeyUp={(e) => {
						const target = e.currentTarget;
						requestSuggestions(target.value, target.selectionStart);
					}}
					onClick={(e) => {
						const target = e.currentTarget;
						requestSuggestions(target.value, target.selectionStart);
					}}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					onDrop={onDrop}
					onDragOver={onDragOver}
				/>
				<div className="composer__footer">
					<div className="composer__modes">
						<div className="mode-toggle" role="group" aria-label={t('chat.composer.modeAria')}>
							<button
								type="button"
								className={`mode-toggle__btn${mode === 'ask' ? ' mode-toggle__btn--active' : ''}`}
								disabled={busy}
								onClick={() => setMode('ask')}
							>
								{t('chat.composer.modeAsk')}
							</button>
							<button
								type="button"
								className={`mode-toggle__btn${mode === 'agent' ? ' mode-toggle__btn--active' : ''}`}
								disabled={busy}
								onClick={() => setMode('agent')}
							>
								{t('chat.composer.modeAgent')}
							</button>
						</div>
						{specialMode ? (
							<button
								type="button"
								className="mode-badge"
								disabled={busy}
								title={t('chat.composer.slashExitHint')}
								onClick={() => setMode('agent')}
							>
								/{mode}
							</button>
						) : null}
					</div>
					<div className="composer__actions">
						{busy ? (
							<button
								className="btn btn--secondary composer__btn"
								type="button"
								onClick={() => vscodeApi.postMessage({ type: 'cancel' })}
							>
								{t('chat.composer.stop')}
							</button>
						) : null}
						<button
							className="btn composer__btn"
							type="submit"
							disabled={!canSend}
						>
							{busy ? t('chat.composer.queue') : t('chat.composer.send')}
						</button>
					</div>
				</div>
			</div>
		</form>
	);
}
