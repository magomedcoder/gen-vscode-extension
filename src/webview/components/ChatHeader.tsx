import { useEffect } from 'react';
import type { ThinkingDisplay } from '../../config/types';
import type { SessionSummary } from '../../chat/sessionStore';
import type { TokenUsage } from '../../llm/usage';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';
import { TokenMeter } from './TokenMeter';

interface ChatHeaderProps {
	usage?: TokenUsage;
	maxContextTokens?: number;
	sessionId?: string;
	sessions?: SessionSummary[];
	toolDetailsExpanded?: boolean;
	onToggleToolDetails?: () => void;
	thinkingDisplay?: ThinkingDisplay;
	onCycleThinkingDisplay?: () => void;
	models?: Array<{ id: string; label: string }>;
	model?: string;
	modelsLoading?: boolean;
	onLoadModels?: () => void;
}

function thinkingToggleLabel(mode: ThinkingDisplay): string {
	if (mode === 'off') {
		return t('chat.thinking.off');
	}

	if (mode === 'expanded') {
		return t('chat.thinking.expanded');
	}

	return t('chat.thinking.collapsed');
}

export function ChatHeader({
	usage,
	maxContextTokens,
	sessionId,
	sessions,
	toolDetailsExpanded = true,
	onToggleToolDetails,
	thinkingDisplay = 'collapsed',
	onCycleThinkingDisplay,
	models,
	model,
	modelsLoading = false,
	onLoadModels,
}: ChatHeaderProps) {
	const list = sessions ?? [];
	const currentId = sessionId ?? list[0]?.id ?? '';
	const currentBusy = Boolean(list.find((s) => s.id === currentId)?.busy);
	const modelList = models ?? [];
	const currentModel = model ?? '';

	useEffect(() => {
		onLoadModels?.();
	}, [onLoadModels]);

	const onSwitch = (id: string) => {
		if (!id || id === currentId) {
			return;
		}

		vscodeApi.postMessage({ type: 'switchSession', id });
	};

	const onRename = () => {
		if (!currentId) {
			return;
		}

		const current = list.find((s) => s.id === currentId);
		const next = window.prompt(t('chat.session.renamePrompt'), current?.title ?? '');
		if (next === null) {
			return;
		}

		const title = next.trim();
		if (!title) {
			return;
		}

		vscodeApi.postMessage({ type: 'renameSession', id: currentId, title });
	};

	const onDelete = () => {
		if (!currentId) {
			return;
		}

		if (!window.confirm(t('chat.session.deleteConfirm'))) {
			return;
		}

		vscodeApi.postMessage({ type: 'deleteSession', id: currentId });
	};

	const onModelChange = (next: string) => {
		if (!next || next === currentModel) {
			return;
		}

		vscodeApi.postMessage({ type: 'setModel', model: next });
	};

	const modelInList = currentModel
		? modelList.some((item) => item.id === currentModel)
		: true;

	return (
		<header className="header">
			<div className="header__left">
				<span className="header__title">{t('chat.header.title')}</span>
				{list.length > 0 ? (
					<div className="session-bar" role="group" aria-label={t('chat.session.aria')}>
						<select
							className="session-bar__select"
							value={currentId}
							data-busy={currentBusy ? 'true' : undefined}
							onChange={(e) => onSwitch(e.target.value)}
							title={t('chat.session.switch')}
						>
							{list.map((s) => (
								<option
									key={s.id}
									value={s.id}
									className={s.busy ? 'session-bar__option--busy' : undefined}
								>
									{s.busy ? `● ${s.title}` : s.title}
								</option>
							))}
						</select>
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							title={t('chat.session.new')}
							onClick={() => vscodeApi.postMessage({ type: 'newSession' })}
						>
							+
						</button>
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							title={t('chat.session.rename')}
							onClick={onRename}
						>
							✎
						</button>
						<button
							className="btn btn--secondary session-bar__btn"
							type="button"
							title={t('chat.session.delete')}
							onClick={onDelete}
						>
							*
						</button>
					</div>
				) : null}
				{modelList.length > 0 || currentModel ? (
					<label className="header-model" aria-label={t('chat.model.aria')}>
						<span className="header-model__label">{t('chat.model.label')}</span>
						<select
							className="header-model__select"
							value={currentModel}
							disabled={modelsLoading || modelList.length === 0}
							onChange={(e) => onModelChange(e.target.value)}
							title={t('chat.model.aria')}
						>
							{!modelInList && currentModel ? (
								<option value={currentModel}>{currentModel}</option>
							) : null}
							{modelList.map((item) => (
								<option key={item.id} value={item.id}>{item.label}</option>
							))}
						</select>
					</label>
				) : null}
			</div>
			<div className="header__actions">
				<TokenMeter usage={usage} maxContextTokens={maxContextTokens} compact />
				{onToggleToolDetails ? (
					<button
						className="btn btn--secondary header__tool-details"
						type="button"
						aria-pressed={toolDetailsExpanded}
						title={toolDetailsExpanded ? t('chat.tool.details.hide') : t('chat.tool.details.show')}
						onClick={onToggleToolDetails}
					>
						{toolDetailsExpanded ? t('chat.tool.details.hide') : t('chat.tool.details.show')}
					</button>
				) : null}
				{onCycleThinkingDisplay ? (
					<button
						className="btn btn--secondary header__tool-details"
						type="button"
						aria-pressed={thinkingDisplay !== 'off'}
						title={thinkingToggleLabel(thinkingDisplay)}
						onClick={onCycleThinkingDisplay}
					>
						{thinkingToggleLabel(thinkingDisplay)}
					</button>
				) : null}
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'openSettings' })}
				>
					{t('chat.header.settings')}
				</button>
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => vscodeApi.postMessage({ type: 'clear' })}
				>
					{t('chat.header.clear')}
				</button>
			</div>
		</header>
	);
}
