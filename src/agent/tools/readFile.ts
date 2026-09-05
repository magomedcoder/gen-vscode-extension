import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { AGENT_LIMITS, looksBinary, previewText } from '../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { resolveWorkspacePath, throwIfAborted } from '../workspacePath';

function isPdfPath(relative: string): boolean {
	return relative.toLowerCase().endsWith('.pdf');
}

function runPdftotext(fsPath: string, signal?: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; missing: boolean; error: string }> {
	return new Promise((resolve) => {
		const child = spawn('pdftotext', ['-layout', fsPath, '-'], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		const onAbort = () => {
			child.kill('SIGTERM');
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		child.stdout.on('data', (d) => {
			stdout += String(d);
		});
		child.stderr.on('data', (d) => {
			stderr += String(d);
		});
		child.on('error', (err) => {
			signal?.removeEventListener('abort', onAbort);
			const msg = err instanceof Error ? err.message : String(err);
			const missing = (err as NodeJS.ErrnoException).code === 'ENOENT' || /ENOENT|not found/i.test(msg);
			resolve({ 
				ok: false, 
				missing, 
				error: msg 
			});
		});
		child.on('close', (code) => {
			signal?.removeEventListener('abort', onAbort);
			if (code === 0) {
				resolve({ 
					ok: true, 
					text: stdout 
				});
				return;
			}
			resolve({
				ok: false,
				missing: false,
				error: stderr.trim() || `pdftotext exit ${code ?? '?'}`,
			});
		});
	});
}

async function readPdfText(resolved: { uri: vscode.Uri; relative: string; fsPath?: string }, signal?: AbortSignal): Promise<ToolResult> {
	const fsPath = resolved.uri.fsPath;
	const extracted = await runPdftotext(fsPath, signal);
	if (extracted.ok) {
		const text = extracted.text.trim();
		if (!text) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.pdfEmpty', resolved.relative),
			};
		}
		return {
			ok: true,
			content: previewText(
				`${vscode.l10n.t('tool.pdfHeader', resolved.relative)}\n${text}`,
				AGENT_LIMITS.maxReadBytes,
			),
		};
	}

	if (extracted.missing) {
		return {
			ok: false,
			content: vscode.l10n.t('tool.pdfNeedPoppler', resolved.relative),
		};
	}

	return {
		ok: false,
		content: vscode.l10n.t('tool.pdfExtractFailed', resolved.relative, extracted.error),
	};
}

export const readFileTool: ToolDefinition = {
	name: 'read_file',
	description: 'Прочитать текстовый файл из workspace (или PDF через pdftotext). Можно указать диапазон строк (1-based, включительно) для текста.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Путь к файлу',
			},
			start_line: {
				type: 'integer',
				description: 'Первая строка (с 1)',
			},
			end_line: {
				type: 'integer',
				description: 'Последняя строка (включительно)',
			},
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));

		if (isPdfPath(resolved.relative)) {
			return readPdfText(resolved, ctx.signal);
		}

		let raw: Uint8Array;
		try {
			raw = await vscode.workspace.fs.readFile(resolved.uri);
		} catch {
			return {
				ok: false,
				content: vscode.l10n.t('tool.fileNotFound', resolved.relative),
			};
		}

		if (looksBinary(raw)) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.binaryFile', resolved.relative),
			};
		}

		if (raw.byteLength > AGENT_LIMITS.maxReadBytes) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.fileTooLarge', raw.byteLength, AGENT_LIMITS.maxReadBytes),
			};
		}

		const text = new TextDecoder('utf8', { fatal: false }).decode(raw);
		const lines = text.split(/\r?\n/);
		const start = Math.max(1, asOptionalInt(args, 'start_line') ?? 1);
		const end = Math.min(lines.length, asOptionalInt(args, 'end_line') ?? lines.length);
		if (start > end) {
			return {
				ok: false,
				content: vscode.l10n.t('tool.badLineRange'),
			};
		}

		const numbered = lines.slice(start - 1, end).map((line, i) => `${String(start + i).padStart(6, ' ')}|${line}`);
		const body = numbered.join('\n');

		return {
			ok: true,
			content: previewText(
				`${vscode.l10n.t('tool.fileHeader', resolved.relative, start, end, lines.length)}\n${body}`,
				AGENT_LIMITS.maxReadBytes,
			),
		};
	},
};
