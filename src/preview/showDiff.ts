import * as vscode from 'vscode';

const SCHEME = 'gen-comment';

// Провайдер виртуальных документов для vscode.diff
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
	private readonly contents = new Map<string, string>();
	private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

	readonly onDidChange = this.emitter.event;

	// Записывает содержимое виртуального документа
	set(uri: vscode.Uri, content: string): void {
		this.contents.set(uri.toString(), content);
		this.emitter.fire(uri);
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? '';
	}

	// Удаляет временный документ из кэша
	clear(uri: vscode.Uri): void {
		this.contents.delete(uri.toString());
	}
}

// Показывает diff исходник <-> с комментариями и спрашивает решение пользователя
export async function showCommentDiff(
	params: {
		provider: DiffContentProvider;
		fileName: string;
		languageId: string;
		original: string;
		commented: string;
	}
): Promise<'apply' | 'reject'> {
	const stamp = Date.now();
	const leftUri = vscode.Uri.parse(`${SCHEME}:original/${stamp}/${params.fileName}?lang=${params.languageId}`);
	const rightUri = vscode.Uri.parse(`${SCHEME}:commented/${stamp}/${params.fileName}?lang=${params.languageId}`);

	params.provider.set(leftUri, params.original);
	params.provider.set(rightUri, params.commented);

	await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `Gen: ${params.fileName} (исходник <-> с комментариями)`);

	const choice = await vscode.window.showInformationMessage(
		'Применить комментарии?',
		{
			modal: false
		}, 
		'Применить',
		'Отклонить'
	);

	params.provider.clear(leftUri);
	params.provider.clear(rightUri);

	return choice === 'Применить' ? 'apply' : 'reject';
}
