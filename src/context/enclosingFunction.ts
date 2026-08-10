import * as vscode from 'vscode';
import { toFragment, type CodeFragment } from './selection';

// Найти функцию/метод вокруг курсора (js/ts - по фигурным скобкам)
export function getEnclosingFunctionFragment(editor: vscode.TextEditor): CodeFragment | undefined {
	const doc = editor.document;
	const cursor = editor.selection.active;

	const range = findBraceEnclosing(doc, cursor);

	if (!range) {
		return undefined;
	}

	const text = doc.getText(range);
	if (!text.trim()) {
		return undefined;
	}

	return toFragment(editor, range, text);
}

// Диапазон ближайшей js/ts-функции, содержащей курсор
function findBraceEnclosing(doc: vscode.TextDocument, cursor: vscode.Position): vscode.Range | undefined {
	const text = doc.getText();
	const cursorOffset = doc.offsetAt(cursor);

	const headerRe = /(?:(?:export\s+)?(?:async\s+)?function\s+\*?[\w$]+|(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|(?:(?:public|private|protected|static|async|get|set|readonly)\s+)*[\w$]+\s*\([^;{}]*\))\s*\{/g;

	let best: {
		start: number
		end: number
	} | undefined;

	for (const match of text.matchAll(headerRe)) {
		const braceIndex = text.indexOf('{', match.index ?? 0);
		if (braceIndex < 0) {
			continue;
		}

		const end = findMatchingBrace(text, braceIndex);
		if (end < 0) {
			continue;
		}

		const start = match.index ?? 0;
		if (cursorOffset >= start && cursorOffset <= end + 1) {
			if (!best || end - start < best.end - best.start) {
				best = {
					start,
					end: end + 1
				};
			}
		}
	}

	if (!best) {
		return undefined;
	}

	return new vscode.Range(doc.positionAt(best.start), doc.positionAt(best.end));
}

// Индекс закрывающей `}` с учётом строк и комментариев; -1 если не найдено
function findMatchingBrace(text: string, openIndex: number): number {
	let depth = 0;
	let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tq' = 'code';

	for (let i = openIndex; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];

		if (state === 'code') {
			if (ch === '/' && next === '/') {
				state = 'line';
				i += 1;
				continue;
			}

			if (ch === '/' && next === '*') {
				state = 'block';
				i += 1;
				continue;
			}

			if (ch === "'") {
				state = 'sq';
				continue;
			}

			if (ch === '"') {
				state = 'dq';
				continue;
			}

			if (ch === '`') {
				state = 'tq';
				continue;
			}

			if (ch === '{') {
				depth += 1;
			} else if (ch === '}') {
				depth -= 1;
				if (depth === 0) {
					return i;
				}
			}

			continue;
		}

		if (state === 'line') {
			if (ch === '\n') {
				state = 'code';
			}

			continue;
		}

		if (state === 'block') {
			if (ch === '*' && next === '/') {
				state = 'code';
				i += 1;
			}

			continue;
		}

		if (ch === '\\') {
			i += 1;
			continue;
		}

		if (state === 'sq' && ch === "'") {
			state = 'code';
		} else if (state === 'dq' && ch === '"') {
			state = 'code';
		} else if (state === 'tq' && ch === '`') {
			state = 'code';
		}
	}

	return -1;
}
