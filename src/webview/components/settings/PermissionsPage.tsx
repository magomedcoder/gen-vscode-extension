import type { ApprovalActionType, ApprovalMode } from '../../../core/config/approvalTypes';
import { EXAMPLE_DENIED_COMMANDS, EXAMPLE_DENIED_PATHS, EXAMPLE_SECRET_PATTERNS, DEFAULT_SENSITIVE_PATH_PATTERNS } from '../../../core/config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { FieldTextarea } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

const APPROVAL_ACTIONS: ApprovalActionType[] = ['shell', 'edits', 'delete', 'mcp', 'web', 'outside', 'task', 'skill'];
const APPROVAL_MODES: ApprovalMode[] = ['allow', 'ask', 'review', 'deny'];

export function PermissionsPage({ draft, setField }: SettingsPageProps) {
	const setListField = (
		key: 'deniedPaths' | 'deniedCommands' | 'secretPatterns' | 'sensitivePathPatterns',
		text: string,
	) => {
		setField(key, text.split(/\r?\n/));
	};

	const setApprovalRule = (
		action: ApprovalActionType,
		patch: Partial<{
			mode: ApprovalMode
			allowlist: string[]
			denylist: string[]
		}>,
	) => {
		const prev = draft.approvalPolicy[action];
		setField('approvalPolicy', {
			...draft.approvalPolicy,
			[action]: {
				...prev,
				...patch,
			},
		});
	};

	return (
		<>
			<SettingsSection titleKey="settings.section.permissions.presets" hintKey="settings.section.permissions.presetsHint">
				<div className="field__row" style={{ flexWrap: 'wrap', gap: 8 }}>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => {
							const next = { ...draft.approvalPolicy };
							for (const action of APPROVAL_ACTIONS) {
								next[action] = { ...next[action], mode: 'ask' };
							}
							setField('approvalPolicy', next);
						}}
					>
						{t('settings.approvalPreset.askAll')}
					</button>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => {
							const next = { ...draft.approvalPolicy };
							for (const action of ['edits', 'mcp', 'web', 'skill', 'task'] as ApprovalActionType[]) {
								next[action] = { ...next[action], mode: 'allow' };
							}
							next.shell = { ...next.shell, mode: 'ask' };
							next.delete = { ...next.delete, mode: 'ask' };
							next.outside = { ...next.outside, mode: 'ask' };
							setField('approvalPolicy', next);
						}}
					>
						{t('settings.approvalPreset.dev')}
					</button>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => {
							const next = { ...draft.approvalPolicy };
							for (const action of APPROVAL_ACTIONS) {
								next[action] = { ...next[action], mode: action === 'delete' ? 'deny' : 'allow' };
							}
							setField('approvalPolicy', next);
						}}
					>
						{t('settings.approvalPreset.allowMost')}
					</button>
				</div>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.permissions.policy" hintKey="settings.section.permissions.policyHint">
				{APPROVAL_ACTIONS.map((action) => {
					const rule = draft.approvalPolicy[action];
					return (
						<div key={action} className="field-card">
							<span className="field-card__title">{t(`settings.approvalPolicy.action.${action}`)}</span>
							<label className="field">
								<span className="field__label">{t('settings.approvalPolicy.mode')}</span>
								<select
									className="field__input"
									value={rule.mode}
									onChange={(e) => setApprovalRule(action, { mode: e.target.value as ApprovalMode })}
								>
									{APPROVAL_MODES.map((mode) => (
										<option key={mode} value={mode}>{mode}</option>
									))}
								</select>
							</label>
							<FieldTextarea
								labelKey="settings.approvalPolicy.allowlist"
								rows={2}
								value={rule.allowlist.join('\n')}
								onChange={(v) => setApprovalRule(action, { allowlist: v.split(/\r?\n/) })}
							/>
							<FieldTextarea
								labelKey="settings.approvalPolicy.denylist"
								rows={2}
								value={rule.denylist.join('\n')}
								onChange={(v) => setApprovalRule(action, { denylist: v.split(/\r?\n/) })}
							/>
						</div>
					);
				})}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.permissions.lists" defaultOpen={false}>
				<div className="field">
					<span className="field__label">{t('settings.deniedPaths.label')}</span>
					<textarea
						className="field__input field__input--multiline"
						rows={6}
						value={draft.deniedPaths.join('\n')}
						placeholder={EXAMPLE_DENIED_PATHS.join('\n')}
						spellCheck={false}
						onChange={(e) => setListField('deniedPaths', e.target.value)}
					/>
					<span className="field__hint">{t('settings.deniedPaths.hint')}</span>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => setField('deniedPaths', [...EXAMPLE_DENIED_PATHS])}
					>
						{t('settings.insertExamples')}
					</button>
				</div>

				<div className="field">
					<span className="field__label">{t('settings.sensitivePathPatterns.label')}</span>
					<textarea
						className="field__input field__input--multiline"
						rows={4}
						value={draft.sensitivePathPatterns.join('\n')}
						placeholder={DEFAULT_SENSITIVE_PATH_PATTERNS.join('\n')}
						spellCheck={false}
						onChange={(e) => setListField('sensitivePathPatterns', e.target.value)}
					/>
					<span className="field__hint">{t('settings.sensitivePathPatterns.hint')}</span>
				</div>

				<div className="field">
					<span className="field__label">{t('settings.deniedCommands.label')}</span>
					<textarea
						className="field__input field__input--multiline"
						rows={6}
						value={draft.deniedCommands.join('\n')}
						placeholder={EXAMPLE_DENIED_COMMANDS.join('\n')}
						spellCheck={false}
						onChange={(e) => setListField('deniedCommands', e.target.value)}
					/>
					<span className="field__hint">{t('settings.deniedCommands.hint')}</span>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => setField('deniedCommands', [...EXAMPLE_DENIED_COMMANDS])}
					>
						{t('settings.insertExamples')}
					</button>
				</div>

				<div className="field">
					<span className="field__label">{t('settings.secretPatterns.label')}</span>
					<textarea
						className="field__input field__input--multiline"
						rows={5}
						value={draft.secretPatterns.join('\n')}
						placeholder={EXAMPLE_SECRET_PATTERNS.join('\n')}
						spellCheck={false}
						onChange={(e) => setListField('secretPatterns', e.target.value)}
					/>
					<span className="field__hint">{t('settings.secretPatterns.hint')}</span>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => setField('secretPatterns', [...EXAMPLE_SECRET_PATTERNS])}
					>
						{t('settings.insertExamples')}
					</button>
				</div>
			</SettingsSection>
		</>
	);
}
