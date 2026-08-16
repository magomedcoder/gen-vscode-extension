import { getSettings } from '../../config/settings';
import { previewText } from '../policy';
import type { ConfirmChoice, ToolContext, ToolResult } from '../types';

export function abortTurn(): never {
	const err = new Error('Операция отменена');
	err.name = 'AbortError';
	throw err;
}

export async function confirmOrSkip(ctx: ToolContext, title: string, detail?: string): Promise<ToolResult | undefined> {
	if (!ctx.confirm) {
		return {
			ok: false,
			denied: true,
			content: 'Действие требует подтверждения, но UI недоступен',
		};
	}

	const choice: ConfirmChoice = await ctx.confirm({
		title,
		detail: detail ? previewText(detail) : undefined
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

export function shouldConfirmWrites(): boolean {
	return getSettings().agentConfirmWrites;
}
