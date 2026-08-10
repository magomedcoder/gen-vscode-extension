import * as vscode from 'vscode';
import { getActiveEditor, getSelectionFragment } from '../context/selection';
import type { DiffContentProvider } from '../preview/showDiff';
import { runCommentPipeline } from './runCommentPipeline';

// Регистрирует команду "Прокомментировать выделение"
export function registerCommentSelection(diffProvider: DiffContentProvider): vscode.Disposable {
	return vscode.commands.registerCommand('gen.commentSelection', async () => {
		const editor = getActiveEditor();
		if (!editor) {
			void vscode.window.showErrorMessage('Нет активного редактора');
			return;
		}

		const fragment = getSelectionFragment(editor);
		if (!fragment) {
			void vscode.window.showErrorMessage('Выделите код для комментирования');
			return;
		}

		await runCommentPipeline({ fragment, diffProvider });
	});
}
