import type * as vscode from 'vscode';
import { DiffContentProvider, registerDiffContentProvider } from './preview/showDiff';

export function registerHostProviders(): {
	diffProvider: DiffContentProvider;
	disposables: vscode.Disposable[];
} {
	const diffProvider = new DiffContentProvider();
	return {
		diffProvider,
		disposables: [registerDiffContentProvider(diffProvider)],
	};
}
