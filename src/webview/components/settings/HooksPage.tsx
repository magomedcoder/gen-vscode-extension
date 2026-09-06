import { useEffect, useState } from 'react';
import type { ExternalHookKind } from '../../../features/chat/protocol';
import { t } from '../../i18n';
import { SettingsSection } from './SettingsSection';

const EXAMPLE_BEFORE_SUBMIT = ['echo "beforeSubmit: $GEN_HOOK_TEXT"'];
const EXAMPLE_BEFORE_SHELL = ['echo "beforeShell: $GEN_HOOK_COMMAND"'];
const EXAMPLE_SESSION_DIFF = ['echo "session.diff: $GEN_HOOK_TURN_ID" && echo "$GEN_HOOK_PATHS"'];
const EXAMPLE_SESSION_COMPACTING = ['echo "session.compacting"'];
const EXAMPLE_SHELL_ENV = ['echo \'{"env":{"GEN_EXAMPLE":"1","GEN_HOOK_CWD_ECHO":"\'"$GEN_HOOK_CWD"\'"}}\''];
const EXAMPLE_FILE_WATCHER = ['echo "file.watcher: $GEN_HOOK_FILE_EVENT $GEN_HOOK_PATH"'];

export type { ExternalHookKind };
export interface ExternalHookFileRow {
	kind: ExternalHookKind;
	path: string;
	mappedCommandCount: number;
	skippedEvents: string[];
	error?: string;
}

export interface HooksPageData {
	beforeSubmit: string[];
	beforeShell: string[];
	sessionDiff: string[];
	sessionCompacting: string[];
	shellEnv: string[];
	fileWatcher: string[];
	path?: string;
	error?: string;
}

export type HooksSavePayload = {
	beforeSubmit: string[];
	beforeShell: string[];
	sessionDiff: string[];
	sessionCompacting: string[];
	shellEnv: string[];
	fileWatcher: string[];
};

interface HooksPageProps {
	hooks?: HooksPageData;
	hooksStatus?: string;
	externalHooks?: ExternalHookFileRow[];
	onLoadHooks?: () => void;
	onSaveHooks?: (payload: HooksSavePayload) => void;
	onOpenHooksFile?: () => void;
	onLoadExternalHooks?: () => void;
	onOpenExternalHookFile?: (path: string) => void;
	onImportExternalHooks?: (path: string, mode: 'merge' | 'replace', kind: ExternalHookKind) => void;
}

function linesToList(raw: string): string[] {
	return raw.split('\n').map((line) => line.trim()).filter(Boolean);
}

function listToLines(list: string[]): string {
	return list.join('\n');
}

function kindLabel(kind: ExternalHookKind): string {
	switch (kind) {
		case 'hooks-json-user':
			return t('settings.hooks.external.kind.hooksJsonUser');
		case 'hooks-json-project':
			return t('settings.hooks.external.kind.hooksJsonProject');
		case 'settings-json-user':
			return t('settings.hooks.external.kind.settingsJsonUser');
		case 'settings-json-project':
			return t('settings.hooks.external.kind.settingsJsonProject');
	}
}

export function HooksPage({
	hooks,
	hooksStatus,
	externalHooks,
	onLoadHooks,
	onSaveHooks,
	onOpenHooksFile,
	onLoadExternalHooks,
	onOpenExternalHookFile,
	onImportExternalHooks,
}: HooksPageProps) {
	const [beforeSubmitText, setBeforeSubmitText] = useState('');
	const [beforeShellText, setBeforeShellText] = useState('');
	const [sessionDiffText, setSessionDiffText] = useState('');
	const [sessionCompactingText, setSessionCompactingText] = useState('');
	const [shellEnvText, setShellEnvText] = useState('');
	const [fileWatcherText, setFileWatcherText] = useState('');

	useEffect(() => {
		onLoadHooks?.();
		onLoadExternalHooks?.();
	}, [onLoadHooks, onLoadExternalHooks]);

	useEffect(() => {
		if (!hooks) {
			return;
		}
		setBeforeSubmitText(listToLines(hooks.beforeSubmit));
		setBeforeShellText(listToLines(hooks.beforeShell));
		setSessionDiffText(listToLines(hooks.sessionDiff));
		setSessionCompactingText(listToLines(hooks.sessionCompacting));
		setShellEnvText(listToLines(hooks.shellEnv));
		setFileWatcherText(listToLines(hooks.fileWatcher));
	}, [hooks]);

	const onSave = () => {
		onSaveHooks?.({
			beforeSubmit: linesToList(beforeSubmitText),
			beforeShell: linesToList(beforeShellText),
			sessionDiff: linesToList(sessionDiffText),
			sessionCompacting: linesToList(sessionCompactingText),
			shellEnv: linesToList(shellEnvText),
			fileWatcher: linesToList(fileWatcherText),
		});
	};

	const onInsertExample = () => {
		setBeforeSubmitText(listToLines(EXAMPLE_BEFORE_SUBMIT));
		setBeforeShellText(listToLines(EXAMPLE_BEFORE_SHELL));
		setSessionDiffText(listToLines(EXAMPLE_SESSION_DIFF));
		setSessionCompactingText(listToLines(EXAMPLE_SESSION_COMPACTING));
		setShellEnvText(listToLines(EXAMPLE_SHELL_ENV));
		setFileWatcherText(listToLines(EXAMPLE_FILE_WATCHER));
	};

	const onImport = (file: ExternalHookFileRow, mode: 'merge' | 'replace') => {
		if (mode === 'replace') {
			const ok = window.confirm(t('settings.hooks.external.replaceConfirm', file.path));
			if (!ok) {
				return;
			}
		} else {
			const ok = window.confirm(t('settings.hooks.external.mergeConfirm', file.path));
			if (!ok) {
				return;
			}
		}
		onImportExternalHooks?.(file.path, mode, file.kind);
	};

	const statusIsError = Boolean(
		hooksStatus
		&& hooksStatus !== t('settings.hooks.saved')
		&& hooksStatus !== t('settings.hooks.saving')
		&& hooksStatus !== t('settings.hooks.external.importing')
		&& !/^(Imported |Импортировано )/.test(hooksStatus),
	);

	const externalList = externalHooks ?? [];

	return (
		<>
			<SettingsSection titleKey="settings.section.hooks.actions" hintKey="settings.hooks.pageHint">
			{hooks?.path ? (<span className="field__hint">{t('settings.hooks.path', hooks.path)}</span>) : null}

			{hooks?.error ? (<span className="field__hint field__hint--error">{hooks.error}</span>) : null}

			{hooksStatus ? (<span className={`field__hint${statusIsError ? ' field__hint--error' : ''}`}>{hooksStatus}</span>) : null}

			<div className="settings__actions">
				<button className="btn" type="button" onClick={onSave}>
					{t('settings.hooks.save')}
				</button>
				<button className="btn btn--secondary" type="button" onClick={() => onLoadHooks?.()}>
					{t('settings.hooks.reload')}
				</button>
				<button className="btn btn--secondary" type="button" onClick={() => onOpenHooksFile?.()}>
					{t('settings.hooks.openFile')}
				</button>
				<button className="btn btn--secondary" type="button" onClick={onInsertExample}>
					{t('settings.hooks.insertExample')}
				</button>
			</div>
			</SettingsSection>

			<SettingsSection titleKey="settings.section.hooks.external" hintKey="settings.hooks.external.hint" defaultOpen={false}>
			<div className="settings__actions">
				<button
					className="btn btn--secondary"
					type="button"
					onClick={() => onLoadExternalHooks?.()}
				>
					{t('settings.hooks.external.reload')}
				</button>
			</div>
			{externalList.length === 0 ? (
				<span className="field__hint">{t('settings.hooks.external.empty')}</span>
			) : (
				<div className="mcp-list">
					{externalList.map((file) => (
						<div key={`${file.kind}:${file.path}`} className="mcp-card">
							<div className="mcp-card__header">
								<div className="mcp-card__title-row">
									<span className="mcp-card__name">{kindLabel(file.kind)}</span>
									<span className="mcp-card__badge mcp-card__badge--ok">
										{t('settings.hooks.external.mappedCount', file.mappedCommandCount)}
									</span>
								</div>
								<div className="settings__actions">
									<button
										className="btn btn--secondary"
										type="button"
										onClick={() => onOpenExternalHookFile?.(file.path)}
									>
										{t('settings.hooks.external.open')}
									</button>
									<button
										className="btn btn--secondary"
										type="button"
										disabled={Boolean(file.error) || file.mappedCommandCount === 0}
										onClick={() => onImport(file, 'merge')}
									>
										{t('settings.hooks.external.importMerge')}
									</button>
									<button
										className="btn btn--secondary"
										type="button"
										disabled={Boolean(file.error) || file.mappedCommandCount === 0}
										onClick={() => onImport(file, 'replace')}
									>
										{t('settings.hooks.external.importReplace')}
									</button>
								</div>
							</div>
							<span className="mcp-card__command">{file.path}</span>
							{file.error ? (
								<span className="field__hint field__hint--error">{file.error}</span>
							) : null}
							{file.skippedEvents.length > 0 ? (
								<span className="field__hint">
									{t('settings.hooks.external.skipped', file.skippedEvents.join(', '))}
								</span>
							) : null}
						</div>
					))}
				</div>
			)}
			</SettingsSection>

			<SettingsSection titleKey="settings.section.hooks.commands" hintKey="settings.section.hooks.commandsHint" defaultOpen={false}>
			<label className="field">
				<span className="field__label">{t('settings.hooks.beforeSubmit.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={8}
					value={beforeSubmitText}
					placeholder={EXAMPLE_BEFORE_SUBMIT.join('\n')}
					spellCheck={false}
					onChange={(e) => setBeforeSubmitText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.beforeSubmit.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.hooks.beforeShell.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={8}
					value={beforeShellText}
					placeholder={EXAMPLE_BEFORE_SHELL.join('\n')}
					spellCheck={false}
					onChange={(e) => setBeforeShellText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.beforeShell.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.hooks.shellEnv.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={6}
					value={shellEnvText}
					placeholder={EXAMPLE_SHELL_ENV.join('\n')}
					spellCheck={false}
					onChange={(e) => setShellEnvText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.shellEnv.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.hooks.sessionDiff.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={6}
					value={sessionDiffText}
					placeholder={EXAMPLE_SESSION_DIFF.join('\n')}
					spellCheck={false}
					onChange={(e) => setSessionDiffText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.sessionDiff.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.hooks.sessionCompacting.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={6}
					value={sessionCompactingText}
					placeholder={EXAMPLE_SESSION_COMPACTING.join('\n')}
					spellCheck={false}
					onChange={(e) => setSessionCompactingText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.sessionCompacting.hint')}</span>
			</label>

			<label className="field">
				<span className="field__label">{t('settings.hooks.fileWatcher.label')}</span>
				<textarea
					className="field__input field__input--code"
					rows={6}
					value={fileWatcherText}
					placeholder={EXAMPLE_FILE_WATCHER.join('\n')}
					spellCheck={false}
					onChange={(e) => setFileWatcherText(e.target.value)}
				/>
				<span className="field__hint">{t('settings.hooks.fileWatcher.hint')}</span>
			</label>
			</SettingsSection>
		</>
	);
}
