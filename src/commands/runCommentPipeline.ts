import * as vscode from 'vscode';
import { applyReplacement } from '../apply/applyEdit';
import { isSelectionStale } from '../apply/staleEdit';
import { getSettings } from '../config/settings';
import type { CodeFragment } from '../context/selection';
import { HttpLlmClient } from '../llm/client';
import { formatTokenCount, type TokenUsage } from '../llm/usage';
import { extractCommentedCode } from '../parse/extractCommentedCode';
import { validateUnchangedCode } from '../parse/validateUnchangedCode';
import { buildCommentMessages } from '../prompt/commentPrompt';
import type { DiffContentProvider } from '../preview/showDiff';
import { showCommentDiff } from '../preview/showDiff';
import { showConfirmDialog } from '../ui/confirmDialog';

async function confirmUnsafeApplyWithoutPreview(message: string): Promise<boolean> {
	const choice = await showConfirmDialog({
		title: message,
		variant: 'binary',
		applyLabel: vscode.l10n.t('comment.applyAnyway'),
		rejectLabel: vscode.l10n.t('comment.cancel'),
	});
	return choice === 'apply';
}

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
		void vscode.window.showErrorMessage(
			vscode.l10n.t('comment.fragmentTooLarge', fragment.text.length, settings.maxInputChars),
		);
		return;
	}

	const messages = buildCommentMessages({
		languageId: fragment.languageId,
		fileName: fragment.fileName,
		code: fragment.text,
		commentStyle: settings.commentStyle,
		commentSystemPrompt: settings.commentSystemPrompt,
	});

	let commented: string;
	let usage: TokenUsage | undefined;

	try {
		commented = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('comment.generatingProgress'),
				cancellable: true,
			},
			async (progress, token) => {
				const controller = new AbortController();
				token.onCancellationRequested(() => controller.abort());

				let streamedChars = 0;
				const result = await client.complete({
					messages,
					signal: controller.signal,
					onDelta: (chunk) => {
						streamedChars += chunk.length;
						progress.report({
							message: vscode.l10n.t('comment.streamingProgress', streamedChars),
						});
					},
				});
				usage = result.usage;
				return extractCommentedCode(result.content);
			},
		);
	} catch (err) {
		void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
		return;
	}

	const usageHint = usage && usage.totalTokens > 0
		? vscode.l10n.t('comment.tokensSuffix', formatTokenCount(usage.totalTokens))
		: '';

	if (!commented.trim()) {
		void vscode.window.showErrorMessage(vscode.l10n.t('comment.extractFailed'));
		return;
	}

	if (commented === fragment.text) {
		void vscode.window.showInformationMessage(vscode.l10n.t('comment.noCommentsAdded', usageHint));
		return;
	}

	const validation = validateUnchangedCode(fragment.text, commented, fragment.languageId);
	const validationMessage = validation.message ?? vscode.l10n.t('comment.codeMayHaveChanged');

	if (!validation.ok && !settings.previewBeforeApply) {
		const proceed = await confirmUnsafeApplyWithoutPreview(validationMessage);
		if (!proceed) {
			return;
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
			unsafeApply: !validation.ok,
		});
		shouldApply = decision === 'apply';
	}

	if (!shouldApply) {
		void vscode.window.showInformationMessage(vscode.l10n.t('comment.notApplied'));
		return;
	}

	if (await isSelectionStale(fragment)) {
		const proceed = await confirmUnsafeApplyWithoutPreview(vscode.l10n.t('comment.staleEditWarning'));
		if (!proceed) {
			void vscode.window.showInformationMessage(vscode.l10n.t('comment.notApplied'));
			return;
		}
	}

	const ok = await applyReplacement(fragment.uri, fragment.range, commented);
	if (ok) {
		void vscode.window.showInformationMessage(vscode.l10n.t('comment.applied', usageHint));
	} else {
		void vscode.window.showErrorMessage(vscode.l10n.t('comment.applyFailed'));
	}
}
