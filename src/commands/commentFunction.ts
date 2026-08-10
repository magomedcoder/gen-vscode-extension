import * as vscode from 'vscode';
import { getEnclosingFunctionFragment } from '../context/enclosingFunction';
import { getActiveEditor } from '../context/selection';
import type { DiffContentProvider } from '../preview/showDiff';
import { runCommentPipeline } from './runCommentPipeline';

// Регистрирует команду "Прокомментировать текущую функцию"
export function registerCommentFunction(diffProvider: DiffContentProvider): vscode.Disposable {
	return vscode.commands.registerCommand('gen.commentFunction', async () => {
		const editor = getActiveEditor();
		if (!editor) {
			void vscode.window.showErrorMessage('Нет активного редактора');
			return;
		}

		const fragment = getEnclosingFunctionFragment(editor);
		if (!fragment) {
			void vscode.window.showErrorMessage('Не удалось найти функцию/метод вокруг курсора');
			return;
		}

		await runCommentPipeline({ fragment, diffProvider });
	});
}
