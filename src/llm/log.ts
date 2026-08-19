import { writeLog } from '../log/logger';

export function logLlm(entry: {
	method: string;
	url: string;
	status?: number;
	ms: number;
	ok: boolean;
	error?: string;
	attempt?: number;
}): void {
	const ts = new Date().toISOString();
	const status = entry.status !== undefined ? String(entry.status) : '-';
	const attempt = entry.attempt && entry.attempt > 1 ? ` try=${entry.attempt}` : '';
	const err = entry.error ? ` ${entry.error.replace(/\s+/g, ' ').slice(0, 240)}` : '';
	writeLog('llm', `[${ts}] ${entry.method} ${entry.url} ${status} ${entry.ms}ms ${entry.ok ? 'ok' : 'fail'}${attempt}${err}`);
}
