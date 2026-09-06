import { useEffect } from 'react';
import type { PersonaOption } from '../../../chat/protocol';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { SettingsSection } from './SettingsSection';

interface PersonasPageProps extends SettingsPageProps {
	personas?: PersonaOption[];
	onLoadPersonas?: () => void;
	onOpenPath?: (path: string) => void;
}

export function PersonasPage({
	draft,
	setField,
	personas = [],
	onLoadPersonas,
	onOpenPath,
}: PersonasPageProps) {
	useEffect(() => {
		onLoadPersonas?.();
	}, [onLoadPersonas]);

	const selectedId = draft.personaId.trim();
	const builtins = personas.filter((p) => p.source === 'builtin');
	const custom = personas.filter((p) => p.source !== 'builtin');

	const applyPersona = (id: string) => {
		setField('personaId', id);
	};

	const clearPersona = () => {
		setField('personaId', '');
	};

	const renderCard = (persona: PersonaOption) => {
		const isActive = selectedId === persona.id;
		const canOpen = Boolean(persona.path?.trim());
		return (
			<div key={persona.id} className="mcp-card">
				<div className="mcp-card__header">
					<div className="mcp-card__title-row">
						<span className="mcp-card__name">{persona.name}</span>
						{persona.source === 'builtin' ? (<span className="mcp-card__badge mcp-card__badge--muted">{t('settings.personas.builtinBadge')}</span>) : null}
						{isActive ? (<span className="mcp-card__badge mcp-card__badge--ok">{t('settings.personas.active')}</span>) : null}
					</div>
					<div className="settings__actions">
						{canOpen ? (
							<button
								className="btn btn--secondary"
								type="button"
								onClick={() => onOpenPath?.(persona.path!)}
							>
								{t('settings.personas.open')}
							</button>
						) : null}
						<button
							className="btn btn--secondary"
							type="button"
							disabled={isActive}
							onClick={() => applyPersona(persona.id)}
						>
							{isActive ? t('settings.personas.applied') : t('settings.personas.apply')}
						</button>
					</div>
				</div>
				{persona.description ? (<span className="mcp-card__tool-desc">{persona.description}</span>) : null}
				{persona.path ? (<span className="mcp-card__command">{persona.path}</span>) : null}
			</div>
		);
	};

	return (
		<>
			<SettingsSection titleKey="settings.section.personas.active" hintKey="settings.personas.pageHint">
			<span className="field__hint">{t('settings.personas.addHint')}</span>

			<div className="settings__actions">
				<button className="btn btn--secondary" type="button" onClick={() => onLoadPersonas?.()}>
					{t('settings.personas.reload')}
				</button>
				<button
					className="btn btn--secondary"
					type="button"
					disabled={!selectedId}
					onClick={clearPersona}
				>
					{t('settings.personas.clear')}
				</button>
			</div>

			{selectedId ? (
				<span className="field__hint">
					{t('settings.personas.selected', selectedId)}
				</span>
			) : (
				<span className="field__hint">{t('settings.personas.noneSelected')}</span>
			)}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.personas.builtin" hintKey="settings.personas.builtinHint">
			{builtins.length === 0 ? (
				<span className="field__hint">{t('settings.personas.builtinEmpty')}</span>
			) : (
				<div className="mcp-list">{builtins.map(renderCard)}</div>
			)}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.personas.custom" hintKey="settings.personas.customHint" defaultOpen={false}>
			{custom.length === 0 ? (
				<span className="field__hint">{t('settings.personas.customEmpty')}</span>
			) : (
				<div className="mcp-list">{custom.map(renderCard)}</div>
			)}
			</SettingsSection>
		</>
	);
}
