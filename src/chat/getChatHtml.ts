export function getChatHtml(params: { cspSource: string; nonce: string }): string {
	const { cspSource, nonce } = params;

	return `<!DOCTYPE html>
<html lang="ru">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Gen Chat</title>
	<style>
		:root {
			--pad: 8px;
		}
			
		html, body {
			height: 100%;
			margin: 0;
		}

		body {
			display: flex;
			flex-direction: column;
			background: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}

		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 6px var(--pad);
			border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
			flex-shrink: 0;
		}

		header .title {
			opacity: 0.8;
			font-size: 12px;
		}

		#messages {
			flex: 1;
			overflow-y: auto;
			padding: var(--pad);
			display: flex;
			flex-direction: column;
			gap: 8px;
		}

		.msg {
			max-width: 92%;
			padding: 8px 10px;
			border-radius: 6px;
			white-space: pre-wrap;
			word-break: break-word;
			line-height: 1.45;
		}

		.msg.user {
			align-self: flex-end;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		.msg.assistant {
			align-self: flex-start;
			background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
			border: 1px solid var(--vscode-widget-border, transparent);
		}

		.msg.error {
			align-self: stretch;
			background: var(--vscode-inputValidation-errorBackground);
			border: 1px solid var(--vscode-inputValidation-errorBorder);
			color: var(--vscode-errorForeground, var(--vscode-foreground));
		}

		.msg.hint {
			align-self: center;
			opacity: 0.7;
			font-size: 12px;
			background: transparent;
			text-align: center;
		}

		.composer {
			display: flex;
			gap: 6px;
			padding: var(--pad);
			border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
			flex-shrink: 0;
		}

		textarea {
			flex: 1;
			resize: none;
			min-height: 40px;
			max-height: 120px;
			padding: 6px 8px;
			border: 1px solid var(--vscode-input-border, transparent);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			font-family: inherit;
			font-size: inherit;
		}

		textarea:focus {
			outline: 1px solid var(--vscode-focusBorder);
		}

		button {
			border: none;
			padding: 6px 10px;
			cursor: pointer;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			font-family: inherit;
		}

		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}

		button:disabled {
			opacity: 0.55;
			cursor: default;
		}
		.busy .send-label { display: none; }
		.cancel-label { display: none; }
		.busy .cancel-label { display: inline; }
	</style>
</head>
<body>
	<header>
		<span class="title">Чат</span>
		<button class="secondary" id="clear" type="button">Очистить</button>
	</header>
	<div id="messages"></div>
	<form class="composer" id="form">
		<textarea id="input" rows="2" placeholder="Сообщение... Enter - отправить, Shift+Enter - строка"></textarea>
		<button id="send" type="submit">
			<span class="send-label">Отправить</span>
			<span class="cancel-label">Стоп</span>
		</button>
	</form>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const messagesEl = document.getElementById('messages');
		const form = document.getElementById('form');
		const input = document.getElementById('input');
		const sendBtn = document.getElementById('send');
		const clearBtn = document.getElementById('clear');

		let busy = false;
		const nodes = new Map();

		function renderMessage(msg) {
			let el = nodes.get(msg.id);
			if (!el) {
				el = document.createElement('div');
				el.className = 'msg ' + msg.role;
				messagesEl.appendChild(el);
				nodes.set(msg.id, el);
			}
			el.className = 'msg ' + msg.role;
			el.textContent = msg.content;
			messagesEl.scrollTop = messagesEl.scrollHeight;
		}

		function setBusy(value) {
			busy = value;
			document.body.classList.toggle('busy', busy);
			input.disabled = busy;
			sendBtn.type = busy ? 'button' : 'submit';
		}

		function showHint() {
			if (messagesEl.childElementCount === 0) {
				const hint = document.createElement('div');
				hint.className = 'msg hint';
				hint.textContent = 'Пусто';
				messagesEl.appendChild(hint);
			}
		}

		window.addEventListener('message', (event) => {
			const data = event.data;
			if (data.type === 'history') {
				messagesEl.innerHTML = '';
				nodes.clear();
				for (const msg of data.messages) {
					renderMessage(msg);
				}

				if (data.messages.length === 0) {
					showHint();
				}

				setBusy(Boolean(data.busy));
			} else if (data.type === 'message') {
				const hint = messagesEl.querySelector('.hint');
				if (hint) {
					hint.remove();
				}
				renderMessage(data.message);
			} else if (data.type === 'busy') {
				setBusy(data.value);
			}
		});

		form.addEventListener('submit', (event) => {
			event.preventDefault();
			if (busy) {
				return;
			}

			const text = input.value.trim();
			if (!text) {
				return;
			}

			input.value = '';
			vscode.postMessage({ type: 'send', text });
		});

		sendBtn.addEventListener('click', (event) => {
			if (busy) {
				event.preventDefault();
				vscode.postMessage({ type: 'cancel' });
			}
		});

		clearBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'clear' });
		});

		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				form.requestSubmit();
			}
		});

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}
