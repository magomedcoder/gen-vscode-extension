import * as vscode from 'vscode';

export class PatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PatchError';
	}
}

export function applySearchReplace(content: string, oldString: string, newString: string, replaceAll: boolean): { text: string; count: number } {
	if (!oldString) {
		throw new PatchError(vscode.l10n.t('patch.emptyOld'));
	}

	if (oldString === newString) {
		throw new PatchError(vscode.l10n.t('patch.same'));
	}

	let count = 0;
	let from = 0;
	while (from <= content.length) {
		const idx = content.indexOf(oldString, from);
		if (idx === -1) {
			break;
		}

		count += 1;
		from = idx + oldString.length;
	}

	if (count === 0) {
		throw new PatchError(vscode.l10n.t('patch.notFound'));
	}

	if (count > 1 && !replaceAll) {
		throw new PatchError(vscode.l10n.t('patch.multiMatch', count));
	}

	const text = replaceAll
		? content.split(oldString).join(newString)
		: content.replace(oldString, newString);

	return { 
		text,
		count: replaceAll ? count : 1
	};
}
