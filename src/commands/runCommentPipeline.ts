import * as vscode from 'vscode';
import { applyReplacement } from '../apply/applyEdit';
import { getSettings } from '../config/settings';
import type { CodeFragment } from '../context/selection';
import { HttpLlmClient } from '../llm/client';
import { formatTokenCount, type TokenUsage } from '../llm/usage';
import { extractCommentedCode } from '../parse/extractCommentedCode';
import { validateUnchangedCode } from '../parse/validateUnchangedCode';
import { buildCommentMessages } from '../prompt/commentPrompt';
import type { DiffContentProvider } from '../preview/showDiff';
import { showCommentDiff } from '../preview/showDiff';

// Общий пайплайн: промпт -> llm -> разбор -> валидация -> diff -> apply
export async function runCommentPipeline(
	params: {
		fragment: CodeFragment;
		diffProvider: DiffContentProvider;
		client?: HttpLlmClient;
	}
): Promise<void> {
	const settings = getSettings();
	const client = params.client ?? new HttpLlmClient();
	const { fragment } = params;

	if (fragment.text.length > settings.maxInputChars) {
		void vscode.window.showErrorMessage(`Фрагмент слишком большой (${fragment.text.length} символов, лимит ${settings.maxInputChars}). Выделите меньший участок.`);
		return;
	}

	const messages = buildCommentMessages({
		languageId: fragment.languageId,
		fileName: fragment.fileName,
		code: fragment.text,
		commentStyle: settings.commentStyle,
	});

	let commented: string;
	let usage: TokenUsage | undefined;

	try {
		commented = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Gen: генерация комментариев...',
				cancellable: true,
			},
			async (_progress, token) => {
				const controller = new AbortController();
				token.onCancellationRequested(() => controller.abort());

				const result = await client.complete({
					messages,
					signal: controller.signal,
				});
				usage = result.usage;
				return extractCommentedCode(result.content);
			},
		);
	} catch (err) {
		void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
		return;
	}

	const usageHint = usage && usage.totalTokens > 0 ? ` ${formatTokenCount(usage.totalTokens)} ток.` : '';

	if (!commented.trim()) {
		void vscode.window.showErrorMessage('Не удалось извлечь код из ответа модели');
		return;
	}

	if (commented === fragment.text) {
		void vscode.window.showInformationMessage(`Модель не добавила комментариев${usageHint}`);
		return;
	}

	const validation = validateUnchangedCode(fragment.text, commented, fragment.languageId);

	if (!validation.ok) {
		if (settings.previewBeforeApply) {
			void vscode.window.showWarningMessage(validation.message ?? 'Код мог измениться');
		} else {
			const proceed = await vscode.window.showWarningMessage(validation.message ?? 'Код мог измениться', 'Применить всё равно', 'Отмена');
			if (proceed !== 'Применить всё равно') {
				return;
			}
		}
	}

	let shouldApply = !settings.previewBeforeApply;

	if (settings.previewBeforeApply) {
		const decision = await showCommentDiff({
			provider: params.diffProvider,
			fileName: fragment.fileName,
			languageId: fragment.languageId,
			original: fragment.text,
			commented,
		});
		shouldApply = decision === 'apply';
	}

	if (!shouldApply) {
		void vscode.window.showInformationMessage('Комментарии не применены');
		return;
	}

	const ok = await applyReplacement(fragment.uri, fragment.range, commented);
	if (ok) {
		void vscode.window.showInformationMessage(`Комментарии применены${usageHint}`);
	} else {
		void vscode.window.showErrorMessage('Не удалось применить правку');
	}
}
