import type { ApprovalActionType, ApprovalMode } from '../../../config/approvalTypes';
import { EXAMPLE_DENIED_COMMANDS, EXAMPLE_DENIED_PATHS, EXAMPLE_SECRET_PATTERNS, DEFAULT_SENSITIVE_PATH_PATTERNS } from '../../../config/types';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';

const APPROVAL_ACTIONS: ApprovalActionType[] = [ 'shell', 'edits', 'delete', 'mcp', 'web', 'outside', 'task', 'skill'];

const APPROVAL_MODES: ApprovalMode[] = ['allow', 'ask', 'review', 'deny'];

export function SecurityPage({ draft, setField }: SettingsPageProps) {
	const setListField = (key: 'deniedPaths' | 'deniedCommands' | 'secretPatterns' | 'sensitivePathPatterns', text: string) => {
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
			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.autoApprove}
					onChange={(e) => setField('autoApprove', e.target.checked)}
				/>
				<span className="field__label">{t('settings.autoApprove.label')}</span>
			</label>
			<span className="field__hint">{t('settings.autoApprove.hint')}</span>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.continueLoopOnDeny}
					onChange={(e) => setField('continueLoopOnDeny', e.target.checked)}
				/>
				<span className="field__label">{t('settings.continueLoopOnDeny.label')}</span>
			</label>
			<span className="field__hint">{t('settings.continueLoopOnDeny.hint')}</span>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.enableFileReading}
					onChange={(e) => setField('enableFileReading', e.target.checked)}
				/>
				<span className="field__label">{t('settings.enableFileReading.label')}</span>
			</label>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.enableTerminal}
					onChange={(e) => setField('enableTerminal', e.target.checked)}
				/>
				<span className="field__label">{t('settings.enableTerminal.label')}</span>
			</label>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.webSearchEnabled}
					onChange={(e) => setField('webSearchEnabled', e.target.checked)}
				/>
				<span className="field__label">{t('settings.webSearchEnabled.label')}</span>
			</label>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.webFetchEnabled}
					onChange={(e) => setField('webFetchEnabled', e.target.checked)}
				/>
				<span className="field__label">{t('settings.webFetchEnabled.label')}</span>
			</label>

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.enableWorkspaceContext}
					onChange={(e) => setField('enableWorkspaceContext', e.target.checked)}
				/>
				<span className="field__label">{t('settings.enableWorkspaceContext.label')}</span>
			</label>

			<div className="field">
				<span className="field__label">{t('settings.approvalPolicy.title')}</span>
				{APPROVAL_ACTIONS.map((action) => {
					const rule = draft.approvalPolicy[action];
					return (
						<div key={action} className="field">
							<span className="field__label">{t(`settings.approvalPolicy.action.${action}`)}</span>
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
							<label className="field">
								<span className="field__label">{t('settings.approvalPolicy.allowlist')}</span>
								<textarea
									className="field__input field__input--multiline"
									rows={2}
									value={rule.allowlist.join('\n')}
									spellCheck={false}
									onChange={(e) => setApprovalRule(action, { allowlist: e.target.value.split(/\r?\n/) })}
								/>
							</label>
							<label className="field">
								<span className="field__label">{t('settings.approvalPolicy.denylist')}</span>
								<textarea
									className="field__input field__input--multiline"
									rows={2}
									value={rule.denylist.join('\n')}
									spellCheck={false}
									onChange={(e) => setApprovalRule(action, { denylist: e.target.value.split(/\r?\n/) })}
								/>
							</label>
						</div>
					);
				})}
			</div>

			<div className="field">
				<span className="field__label">{t('settings.deniedPaths.label')}</span>
				<textarea
					className="field__input field__input--multiline"
					rows={8}
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

			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.allowExternalDirectory}
					onChange={(e) => setField('allowExternalDirectory', e.target.checked)}
				/>
				<span className="field__label">{t('settings.allowExternalDirectory.label')}</span>
			</label>
			<span className="field__hint">{t('settings.allowExternalDirectory.hint')}</span>

			<div className="field">
				<span className="field__label">{t('settings.deniedCommands.label')}</span>
				<textarea
					className="field__input field__input--multiline"
					rows={8}
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
					rows={6}
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
		</>
	);
}
