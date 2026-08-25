import * as vscode from 'vscode';
import { getAgentAuthLevel, shouldConfirmDeletes, shouldConfirmWrites } from '../auth';
import { previewText } from '../policy';
import { throwIfAborted } from '../workspacePath';
import type { ConfirmChoice, ToolContext, ToolResult } from '../types';

export function abortTurn(): never {
	const err = new Error(vscode.l10n.t('agent.operationCancelled'));
	err.name = 'AbortError';
	throw err;
}

export async function confirmOrSkip(ctx: ToolContext, title: string, detail?: string): Promise<ToolResult | undefined> {
	throwIfAborted(ctx.signal);
	if (!ctx.confirm) {
		return {
			ok: false,
			denied: true,
			content: vscode.l10n.t('agent.confirmUiUnavailable'),
		};
	}

	const choice: ConfirmChoice = await new Promise((resolve, reject) => {
		const onAbort = () => {
			const err = new Error(vscode.l10n.t('agent.operationCancelled'));
			err.name = 'AbortError';
			reject(err);
		};
		if (ctx.signal?.aborted) {
			onAbort();
			return;
		}

		ctx.signal?.addEventListener('abort', onAbort, { once: true });
		void Promise.resolve(ctx.confirm!({
			title,
			detail: detail ? previewText(detail) : undefined,
		})).then((value) => {
			ctx.signal?.removeEventListener('abort', onAbort);
			resolve(value);
		}, (err: unknown) => {
			ctx.signal?.removeEventListener('abort', onAbort);
			reject(err);
		});
	});

	if (choice === 'apply') {
		return undefined;
	}

	if (choice === 'skip') {
		return {
			ok: false,
			denied: true,
			content: vscode.l10n.t('agent.userDenied'),
		};
	}

	abortTurn();
}

/**
 * Подтверждение для опасных tools (команды, план, overwrite user-diff).
 * В режиме «Без спроса» (`open`) диалог не показывается - действие выполняется и пишется в лог
 */
export async function confirmAlwaysOrSkip(ctx: ToolContext, title: string, detail?: string): Promise<ToolResult | undefined> {
	if (getAgentAuthLevel() === 'open') {
		return undefined;
	}

	return confirmOrSkip(ctx, title, detail);
}

export { shouldConfirmDeletes, shouldConfirmWrites };
