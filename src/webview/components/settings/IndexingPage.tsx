import { useEffect } from 'react';
import type { IndexEngineStatus } from '../../../chat/protocol';
import { t } from '../../i18n';
import type { SettingsPageProps } from './pages';
import { FieldTextarea, FieldToggle } from './SettingsFields';
import { SettingsSection } from './SettingsSection';

interface IndexingPageProps extends SettingsPageProps {
	indexStatus?: IndexEngineStatus;
	onLoadIndexStatus?: () => void;
}

function formatIndexUpdatedAt(iso?: string): string | undefined {
	if (!iso) {
		return undefined;
	}
	const ms = new Date(iso).getTime();
	if (!Number.isFinite(ms) || ms <= 0) {
		return undefined;
	}
	try {
		return new Date(ms).toLocaleString();
	} catch {
		return iso;
	}
}

function indexEngineModeLabel(mode: IndexEngineStatus['mode']): string {
	switch (mode) {
		case 'remote':
			return t('settings.indexEngine.remote');
		case 'onnx-gpu':
			return t('settings.indexEngine.onnxGpu');
		case 'cpu-trigram':
		default:
			return t('settings.indexEngine.cpuTrigram');
	}
}

function buildIndexEngineLine(status: IndexEngineStatus): string {
	const parts = [indexEngineModeLabel(status.mode)];

	if (!status.indexingEnabled) {
		parts.push(t('settings.indexEngine.disabled'));
	} else if (status.progressState === 'indexing') {
		parts.push(t('settings.indexEngine.indexing'));
	} else if (status.progressState === 'error') {
		parts.push(t('settings.indexEngine.error'));
	}

	if (typeof status.fileCount === 'number' && status.fileCount > 0) {
		parts.push(t('settings.indexEngine.files', status.fileCount));
	}

	const updated = formatIndexUpdatedAt(status.updatedAt);
	if (updated) {
		parts.push(t('settings.indexEngine.updated', updated));
	}

	return `${t('settings.indexEngine.label')}: ${parts.toString()}`;
}

export function IndexingPage({
	draft,
	setField,
	indexStatus,
	onLoadIndexStatus,
}: IndexingPageProps) {
	useEffect(() => {
		onLoadIndexStatus?.();
	}, [onLoadIndexStatus]);

	return (
		<SettingsSection titleKey="settings.section.indexing" hintKey="settings.section.indexingHint">
			{indexStatus ? (
				<div className="field field-status" role="status">
					<span className="field__label">{buildIndexEngineLine(indexStatus)}</span>
					<span className="field__hint">{t('settings.indexEngine.hint')}</span>
					{indexStatus.lastError ? (
						<span className="field__hint field__hint--error">{indexStatus.lastError}</span>
					) : null}
				</div>
			) : null}

			<FieldToggle
				labelKey="settings.indexingEnabled.label"
				hintKey="settings.indexingEnabled.hint"
				checked={draft.indexingEnabled}
				onChange={(v) => setField('indexingEnabled', v)}
			/>
			<FieldToggle
				labelKey="settings.indexNewFolders.label"
				hintKey="settings.indexNewFolders.hint"
				checked={draft.indexNewFolders}
				onChange={(v) => setField('indexNewFolders', v)}
			/>
			<FieldToggle
				labelKey="settings.indexForGrep.label"
				hintKey="settings.indexForGrep.hint"
				checked={draft.indexForGrep}
				onChange={(v) => setField('indexForGrep', v)}
			/>
			<FieldTextarea
				labelKey="settings.watcherIgnore.label"
				hintKey="settings.watcherIgnore.hint"
				code
				rows={3}
				value={draft.watcherIgnore.join('\n')}
				onChange={(v) => setField('watcherIgnore', v.split(/\r?\n/))}
			/>
		</SettingsSection>
	);
}
