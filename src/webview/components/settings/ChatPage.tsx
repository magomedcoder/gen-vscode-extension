import type { PersonaOption } from '../../../chat/protocol';
import type { ChatMode, ChatTextSize, ChatViewLocation, CommentStyle, ThinkingDisplay } from '../../../config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { FieldSelect, FieldText, FieldTextarea, FieldToggle } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

interface ChatPageProps extends SettingsPageProps {
	personas?: PersonaOption[];
	onOpenPersonasPage?: () => void;
}

// Внешний вид чата, уведомления и комментарии
export function ChatPage({
	draft,
	setField,
	personas = [],
	onOpenPersonasPage,
}: ChatPageProps) {
	const personaValue = draft.personaId && personas.some((p) => p.id === draft.personaId) ? draft.personaId : '';

	return (
		<>
			<span className="field__hint">{t('settings.chat.referencesHint')}</span>

			<SettingsSection titleKey="settings.section.chat.basics" hintKey="settings.section.chat.basicsHint" defaultOpen={false}>
				<FieldSelect
					labelKey="settings.chatMode.label"
					value={draft.chatMode}
					onChange={(v) => setField('chatMode', v as ChatMode)}
				>
					<option value="ask">{t('settings.chatMode.ask')}</option>
					<option value="agent">{t('settings.chatMode.agent')}</option>
					<option value="plan">{t('settings.chatMode.plan')}</option>
					<option value="multitask">{t('settings.chatMode.multitask')}</option>
					<option value="debug">{t('settings.chatMode.debug')}</option>
					<option value="design">{t('settings.chatMode.design')}</option>
				</FieldSelect>

				<FieldSelect
					labelKey="settings.chatTextSize.label"
					hintKey="settings.chatTextSize.hint"
					value={draft.chatTextSize}
					onChange={(v) => setField('chatTextSize', v as ChatTextSize)}
				>
					<option value="compact">{t('settings.chatTextSize.compact')}</option>
					<option value="default">{t('settings.chatTextSize.default')}</option>
					<option value="large">{t('settings.chatTextSize.large')}</option>
				</FieldSelect>

				<FieldSelect
					labelKey="settings.thinkingDisplay.label"
					hintKey="settings.thinkingDisplay.hint"
					value={draft.thinkingDisplay}
					onChange={(v) => setField('thinkingDisplay', v as ThinkingDisplay)}
				>
					<option value="off">{t('settings.thinkingDisplay.off')}</option>
					<option value="collapsed">{t('settings.thinkingDisplay.collapsed')}</option>
					<option value="expanded">{t('settings.thinkingDisplay.expanded')}</option>
				</FieldSelect>

				<FieldSelect
					labelKey="settings.chatViewLocation.label"
					hintKey="settings.chatViewLocation.hint"
					value={draft.chatViewLocation}
					onChange={(v) => setField('chatViewLocation', v as ChatViewLocation)}
				>
					<option value="panel">{t('settings.chatViewLocation.panel')}</option>
					<option value="sidebar">{t('settings.chatViewLocation.sidebar')}</option>
					<option value="both">{t('settings.chatViewLocation.both')}</option>
				</FieldSelect>

				<FieldSelect
					labelKey="settings.personaId.label"
					hintKey="settings.personaId.hint"
					value={personaValue}
					onChange={(v) => setField('personaId', v)}
				>
					<option value="">{t('settings.personaId.none')}</option>
					{personas.map((p) => (
						<option key={p.id} value={p.id} title={p.description}>{p.name}</option>
					))}
				</FieldSelect>

				{onOpenPersonasPage ? (
					<div className="settings__actions">
						<button
							className="btn btn--secondary"
							type="button"
							onClick={() => onOpenPersonasPage()}
						>
							{t('settings.personaId.openPage')}
						</button>
					</div>
				) : null}

				<FieldText
					labelKey="settings.usernameDisplay.label"
					hintKey="settings.usernameDisplay.hint"
					value={draft.usernameDisplay}
					onChange={(v) => setField('usernameDisplay', v)}
					spellCheck={false}
				/>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.chat.notify" defaultOpen={false}>
				<FieldToggle
					labelKey="settings.notifyOnComplete.label"
					hintKey="settings.notifyOnComplete.hint"
					checked={draft.notifyOnComplete}
					onChange={(v) => setField('notifyOnComplete', v)}
				/>
				<FieldToggle
					labelKey="settings.notifySoundOnComplete.label"
					hintKey="settings.notifySoundOnComplete.hint"
					checked={draft.notifySoundOnComplete}
					onChange={(v) => setField('notifySoundOnComplete', v)}
					disabled={!draft.notifyOnComplete}
				/>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.comments" hintKey="settings.section.commentsHint" defaultOpen={false}>
				<FieldSelect
					labelKey="settings.commentStyle.label"
					value={draft.commentStyle}
					onChange={(v) => setField('commentStyle', v as CommentStyle)}
				>
					<option value="inline">{t('settings.commentStyle.inline')}</option>
					<option value="block">{t('settings.commentStyle.block')}</option>
				</FieldSelect>

				<FieldToggle
					labelKey="settings.previewBeforeApply.label"
					checked={draft.previewBeforeApply}
					onChange={(v) => setField('previewBeforeApply', v)}
				/>

				<FieldTextarea
					labelKey="settings.commentSystemPrompt.label"
					rows={4}
					placeholder={t('settings.commentSystemPrompt.placeholder')}
					value={draft.commentSystemPrompt}
					onChange={(v) => setField('commentSystemPrompt', v)}
					spellCheck
				/>
			</SettingsSection>
		</>
	);
}
