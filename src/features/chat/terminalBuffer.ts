import * as vscode from 'vscode';

// Сколько символов держим на терминал в ring-буфере
const MAX_BUFFER_CHARS = 8_000;

const buffers = new Map<string, string>();
let started = false;
let subscription: vscode.Disposable | undefined;

function terminalKey(term: vscode.Terminal): string {
	return term.name || 'Terminal';
}

function append(key: string, data: string): void {
	if (!data) {
		return;
	}

	const prev = buffers.get(key) ?? '';
	const next = (prev + data).length > MAX_BUFFER_CHARS ? (prev + data).slice(-MAX_BUFFER_CHARS) : prev + data;
	buffers.set(key, next);
}

/**
 * Подписка на вывод терминалов через стабильный API `onDidEndTerminalShellExecution` + `execution.read()`.
 *
 * Не используем proposed `onDidWriteTerminalData`: без `enabledApiProposals` VS Code падает при активации расширения.
 * Идемпотентно - повторный вызов безопасен.
 */
export function ensureTerminalBufferListener(): vscode.Disposable {
	if (started && subscription) {
		return subscription;
	}

	started = true;
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.window.onDidEndTerminalShellExecution((e) => {
			void (async () => {
				try {
					let chunk = '';
					for await (const data of e.execution.read()) {
						chunk += data;
						if (chunk.length >= MAX_BUFFER_CHARS) {
							break;
						}
					}
					append(terminalKey(e.terminal), chunk.slice(0, MAX_BUFFER_CHARS));
				} catch {}
			})();
		}),
	);

	disposables.push(
		vscode.window.onDidCloseTerminal((term) => {
			buffers.delete(terminalKey(term));
		}),
	);

	subscription = vscode.Disposable.from(...disposables, {
		dispose: () => {
			started = false;
			subscription = undefined;
			buffers.clear();
		},
	});
	return subscription;
}

// Снимки буферов открытых терминалов (имя * хвост вывода)
export function getTerminalBuffers(): Array<{
	name: string;
	text: string
}> {
	ensureTerminalBufferListener();

	const out: Array<{ 
		name: string
		text: string
	}> = [];
	const seen = new Set<string>();

	for (const term of vscode.window.terminals) {
		const name = terminalKey(term);
		if (seen.has(name)) {
			continue;
		}

		seen.add(name);
		out.push({ 
			name, 
			text: buffers.get(name) ?? '' 
		});
	}

	return out;
}
