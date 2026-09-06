import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { t } from '../../i18n';

interface SettingsSectionProps {
	titleKey: string;
	children: ReactNode;
	hintKey?: string;
	defaultOpen?: boolean;
}

export function SettingsSection({
	titleKey,
	hintKey,
	children,
	defaultOpen = false,
}: SettingsSectionProps) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<details
			className="settings-section"
			open={open}
			onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => {
				setOpen(e.currentTarget.open);
			}}
		>
			<summary className="settings-section__summary">
				<span className="settings-section__chevron" aria-hidden="true" />
				<span className="settings-section__heading">
					<span className="settings-section__title">{t(titleKey)}</span>
					{hintKey ? <span className="settings-section__hint">{t(hintKey)}</span> : null}
				</span>
			</summary>
			<div className="settings-section__body">{children}</div>
		</details>
	);
}
