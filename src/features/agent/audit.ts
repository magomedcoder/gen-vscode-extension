import { writeLog } from '../../core/log/logger';
import { redactSecrets } from './secrets';

export function logAgentTool(entry: {
	name: string;
	status: 'ok' | 'error' | 'denied';
	ms: number;
	detail?: string;
}): void {
	const ts = new Date().toISOString();
	const detail = entry.detail ? redactSecrets(entry.detail).text.replace(/\s+/g, ' ').slice(0, 240) : '';
	writeLog('agent', `[${ts}] ${entry.name} ${entry.status} ${entry.ms}ms${detail ? ` ${detail}` : ''}`);
}
