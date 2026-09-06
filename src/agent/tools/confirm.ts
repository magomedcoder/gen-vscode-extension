import * as vscode from 'vscode';
import { getSettings } from '../../config/settings';
import { shouldConfirmDeletes, shouldConfirmWrites } from '../auth';
import { previewText } from '../policy';
import { throwIfAborted } from '../workspacePath';
import type { ConfirmChoice, ToolContext, ToolResult } from '../types';

export function abortTurn(): never {
	const err = new Error(vscode.l10n.t('agent.operationCancelled'));
	err.name = 'AbortError';
	throw err;
}

export async function confirmOrSkip(
	ctx: ToolContext,
	title: string,
	detail?: string,
	opts?: { suggestion?: string; allowAlways?: boolean },
): Promise<ToolResult | undefined> {
	throwIfAborted(ctx.signal);
	const ext = ctx as ToolContext & { 
		skipConfirm?: boolean
		forceConfirm?: boolean
	};
	// forceConfirm (Plan shell ask) перекрывает autoApprove / skipConfirm
	if (!ext.forceConfirm && (ext.skipConfirm || getSettings().autoApprove)) {
		return undefined;
	}
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
			suggestion: opts?.suggestion,
			allowAlways: opts?.allowAlways,
		})).then((value) => {
			ctx.signal?.removeEventListener('abort', onAbort);
			resolve(value);
		}, (err: unknown) => {
			ctx.signal?.removeEventListener('abort', onAbort);
			reject(err);
		});
	});

	if (choice === 'apply' || choice === 'always') {
		const onAlways = (ctx as ToolContext & { onAlwaysAllow?: (pattern: string) => void }).onAlwaysAllow;
		if (choice === 'always' && opts?.suggestion && onAlways) {
			onAlways(opts.suggestion);
		}

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

export async function confirmAlwaysOrSkip(ctx: ToolContext, title: string, detail?: string): Promise<ToolResult | undefined> {
	const forceConfirm = (ctx as ToolContext & { forceConfirm?: boolean }).forceConfirm;
	if (!forceConfirm && getSettings().autoApprove) {
		return undefined;
	}

	const suggestion = (ctx as ToolContext & { suggestAlwaysPattern?: string }).suggestAlwaysPattern;
	return confirmOrSkip(ctx, title, detail, {
		allowAlways: true,
		suggestion,
	});
}

export { shouldConfirmDeletes, shouldConfirmWrites };
