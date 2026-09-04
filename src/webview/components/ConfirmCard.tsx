import { vscodeApi } from '../vscodeApi';
import type { PendingConfirm } from '../../chat/protocol';
import { ConfirmPanel } from './ConfirmPanel';

interface ConfirmCardProps {
	confirm: PendingConfirm;
}

export function ConfirmCard({ confirm }: ConfirmCardProps) {
	return (
		<ConfirmPanel
			title={confirm.title}
			detail={confirm.detail}
			hint={confirm.hint}
			variant={confirm.variant}
			applyLabel={confirm.applyLabel}
			skipLabel={confirm.skipLabel}
			stopLabel={confirm.stopLabel}
			rejectLabel={confirm.rejectLabel}
			alwaysLabel={confirm.alwaysLabel}
			suggestion={confirm.suggestion}
			allowAlways={confirm.allowAlways}
			onChoose={(choice) => {
				vscodeApi.postMessage({
					type: 'confirmChoice',
					id: confirm.id,
					choice,
				});
			}}
		/>
	);
}
