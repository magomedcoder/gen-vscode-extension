import * as vscode from 'vscode';

export const GENRULES_RELATIVE = '.genrules';
export const MAX_GENRULES_CHARS = 12_000;

export function normalizeGenRulesText(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (!trimmed) {
		return undefined;
	}

	if (trimmed.length <= MAX_GENRULES_CHARS) {
		return trimmed;
	}

	return `${trimmed.slice(0, MAX_GENRULES_CHARS)}\n\n[Gen: .genrules обрезан до ${MAX_GENRULES_CHARS} символов]`;
}

export function formatGenRulesForPrompt(text: string): string {
	return `Правила проекта (файл .genrules в корне workspace):\n${text}`;
}

let manager: GenRulesManager | undefined;

export function initGenRulesManager(context: vscode.ExtensionContext): GenRulesManager {
	manager = new GenRulesManager();
	context.subscriptions.push(manager);
	return manager;
}

export function getGenRulesManager(): GenRulesManager | undefined {
	return manager;
}

// Файл `.genrules` в корне workspace: стиль, архитектура, ограничения команды
export class GenRulesManager implements vscode.Disposable {
	private text: string | undefined;
	private ready = false;
	private readonly disposables: vscode.Disposable[] = [];

	constructor() {
		void this.reload();
		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				void this.reload();
			}),
		);
		this.startWatching();
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}

		this.disposables.length = 0;
	}

	getText(): string | undefined {
		return this.text;
	}

	getPromptAppendix(): string | undefined {
		const text = this.text;
		return text ? formatGenRulesForPrompt(text) : undefined;
	}

	async reload(): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			this.text = undefined;
			this.ready = true;
			return;
		}

		const uri = vscode.Uri.joinPath(folder.uri, GENRULES_RELATIVE);
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const raw = new TextDecoder().decode(bytes);
			this.text = normalizeGenRulesText(raw);
		} catch {
			this.text = undefined;
		}

		this.ready = true;
	}

	isReady(): boolean {
		return this.ready;
	}

	private startWatching(): void {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}

		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(folder, GENRULES_RELATIVE),
		);
		const notify = () => {
			void this.reload();
		};
		this.disposables.push(
			watcher,
			watcher.onDidChange(notify),
			watcher.onDidCreate(notify),
			watcher.onDidDelete(notify),
		);
	}
}
