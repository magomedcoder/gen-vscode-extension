import * as fs from 'node:fs';
import * as vscode from 'vscode';

export interface WebviewL10nPack {
	locale: string;
	strings: Record<string, string>;
}

function readJson(uri: vscode.Uri): Record<string, string> | undefined {
	try {
		const raw = fs.readFileSync(uri.fsPath, 'utf8');
		const parsed = JSON.parse(raw) as Record<string, string>;
		return parsed && typeof parsed === 'object' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

// Английский fallback + перевод по vscode.env.language для webview
export function loadWebviewL10n(extensionUri: vscode.Uri): WebviewL10nPack {
	const locale = vscode.env.language || 'en';
	const lang = locale.split('-')[0] || 'en';
	const l10nRoot = vscode.Uri.joinPath(extensionUri, 'l10n');

	const en =
		readJson(vscode.Uri.joinPath(l10nRoot, 'bundle.l10n.json'))
		?? {};

	if (lang === 'en') {
		return { locale: 'en', strings: en };
	}

	const localized = readJson(vscode.Uri.joinPath(l10nRoot, `bundle.l10n.${locale}.json`))
		?? readJson(vscode.Uri.joinPath(l10nRoot, `bundle.l10n.${lang}.json`))
		?? {};

	return {
		locale: lang,
		strings: { 
			...en, 
			...localized 
		},
	};
}
