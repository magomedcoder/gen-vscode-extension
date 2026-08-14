import type { Uri } from 'vscode';

export function renderChatHtml(params: {
	cspSource: string;
	nonce: string;
	scriptUri: Uri;
	styleUri: Uri;
}): string {
	const { cspSource, nonce, scriptUri, styleUri } = params;

	return `<!DOCTYPE html>
<html lang="ru">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src ${cspSource} 'nonce-${nonce}'; img-src https: data:;">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Gen Чат</title>
	<link href="${styleUri}" rel="stylesheet">
</head>
<body>
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
