import { useEffect, useRef, useState, type KeyboardEvent, type SubmitEvent } from 'react';
import type { ChatMode, MentionSuggestion } from '../../chat/protocol';
import { activeSlashQuery, filterSlashCommands } from '../../chat/slashCommands';
import type { SlashCommand } from '../../chat/slashCommands';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

interface ComposerProps {
	busy: boolean;
	queuedCount: number;
	mode: ChatMode;
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
	if (/\s/.test(fragment) && !/^(file|folder|codebase|git|link)\s+\S*$/i.test(fragment)) {
		return undefined;
	}

	return { start: at, query: fragment };
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
	return t(cmd.detailKey);
}

export function Composer({ busy, queuedCount, mode }: ComposerProps) {
	const [draft, setDraft] = useState('');
	const [chips, setChips] = useState<ContextChip[]>([]);
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
			const items = filterSlashCommands(slash.query);
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

	const submit = () => {
		const question = draft.trim();
		const prefix = chips.map((c) => c.insert).join(' ').trim();
		const text = [prefix, question].filter(Boolean).join(' ').trim();
		if (!text) {
			return;
		}

		setDraft('');
		setChips([]);
		clearSuggest();
		vscodeApi.postMessage({ type: 'send', text });
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

		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	};

	const canSend = Boolean(draft.trim()) || chips.length > 0;
	const specialMode = mode === 'debug' || mode === 'design' || mode === 'plan';

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
