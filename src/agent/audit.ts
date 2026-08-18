import * as vscode from 'vscode';
import { redactSecrets } from './secrets';

let channel: vscode.OutputChannel | undefined;

export function initAgentAudit(context: vscode.ExtensionContext): void {
	channel = vscode.window.createOutputChannel('Gen Agent');
	context.subscriptions.push(channel);
}

export function logAgentTool(entry: {
	name: string;
	status: 'ok' | 'error' | 'denied';
	ms: number;
	detail?: string;
}): void {
	const ts = new Date().toISOString();
	const detail = entry.detail ? redactSecrets(entry.detail).text.replace(/\s+/g, ' ').slice(0, 240) : '';
	const line = `[${ts}] ${entry.name} ${entry.status} ${entry.ms}ms${detail ? ` ${detail}` : ''}`;
	channel?.appendLine(line);
}
