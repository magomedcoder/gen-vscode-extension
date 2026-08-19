import type { Uri } from 'vscode';

export function renderChatHtml(params: {
	cspSource: string;
	nonce: string;
	scriptUri: Uri;
	styleUri: Uri;
	title?: string;
	screen?: 'chat' | 'settings';
}): string {
	const { cspSource, nonce, scriptUri, styleUri } = params;
	const title = params.title ?? 'Gen Чат';
	const screen = params.screen ?? 'chat';

	return `<!DOCTYPE html>
<html lang="ru">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src ${cspSource} 'nonce-${nonce}'; img-src https: data:;">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${title}</title>
	<link href="${styleUri}" rel="stylesheet">
</head>
<body data-screen="${screen}">
	<div id="root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function createNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let i = 0; i < 32; i += 1) {
		value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	}

	return value;
}
