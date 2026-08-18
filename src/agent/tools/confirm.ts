import { previewText } from '../policy';
import { shouldConfirmDeletes, shouldConfirmWrites } from '../auth';
import { throwIfAborted } from '../workspacePath';
import type { ConfirmChoice, ToolContext, ToolResult } from '../types';

export function abortTurn(): never {
	const err = new Error('Операция отменена');
	err.name = 'AbortError';
	throw err;
}

export async function confirmOrSkip(ctx: ToolContext, title: string, detail?: string): Promise<ToolResult | undefined> {
	throwIfAborted(ctx.signal);
	if (!ctx.confirm) {
		return {
			ok: false,
			denied: true,
			content: 'Действие требует подтверждения, но UI недоступен',
		};
	}

	const choice: ConfirmChoice = await new Promise((resolve, reject) => {
		const onAbort = () => {
			const err = new Error('Операция отменена');
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
			content: 'Пользователь отклонил действие',
		};
	}

	abortTurn();
}

export { shouldConfirmDeletes, shouldConfirmWrites };
