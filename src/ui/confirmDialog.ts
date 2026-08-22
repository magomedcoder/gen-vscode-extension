import * as vscode from 'vscode';
import type { ConfirmChoice } from '../agent/types';
import type { ConfirmVariant } from '../chat/protocol';

export interface ConfirmDialogOptions {
	title: string;
	detail?: string;
	// Режим agent: Применить / Пропустить / Стоп; binary: Применить / Отклонить
	variant?: ConfirmVariant;
	applyLabel?: string;
	rejectLabel?: string;
}

export type ConfirmHost = (options: ConfirmDialogOptions) => Promise<ConfirmChoice>;

let host: ConfirmHost | undefined;

// Регистрирует хост подтверждений (карточка в чате)
export function setConfirmHost(next: ConfirmHost | undefined): void {
	host = next;
}

// Единая точка подтверждения: карточка в панели Gen (не отдельная вкладка)
export async function showConfirmDialog(options: ConfirmDialogOptions): Promise<ConfirmChoice> {
	if (!host) {
		throw new Error('Confirm host не зарегистрирован (чат ещё не инициализирован)');
	}

	await vscode.commands.executeCommand('gen.chatView.focus').then(undefined, () => undefined);
	return host(options);
}
