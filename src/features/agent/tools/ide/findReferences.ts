import * as vscode from 'vscode';
import { AGENT_LIMITS } from '../../policy';
import { asOptionalInt, asString, type ToolContext, type ToolDefinition, type ToolResult } from '../../types';
import { relativeFromUri, resolveWorkspacePath, throwIfAborted } from '../../workspacePath';

function locationPayload(loc: vscode.Location | vscode.LocationLink): Record<string, unknown> {
	if (loc instanceof vscode.Location) {
		return {
			uri: loc.uri.toString(),
			range: {
				start: { 
					line: loc.range.start.line, 
					character: loc.range.start.character 
				},
				end: { 
					line: loc.range.end.line, 
					character: loc.range.end.character 
				},
			},
		};
	}
	const target = loc.targetSelectionRange ?? loc.targetRange;
	return {
		uri: loc.targetUri.toString(),
		range: {
			start: { 
				line: target.start.line, 
				character: target.start.character 
			},
			end: { 
				line: target.end.line, 
				character: target.end.character 
			},
		},
	};
}

async function enrichLocations(
	items: Array<vscode.Location | vscode.LocationLink>,
): Promise<Array<Record<string, unknown>>> {
	const out: Array<Record<string, unknown>> = [];
	for (const item of items.slice(0, AGENT_LIMITS.maxDiagnostics)) {
		const base = locationPayload(item);
		try {
			const uri = item instanceof vscode.Location ? item.uri : item.targetUri;
			base.path = await relativeFromUri(uri);
		} catch {
			base.path = null;
		}
		out.push(base);
	}
	return out;
}

/**
 * Резолв имени символа в позицию definition через document symbols, затем references.
 * Предпочитать path+line+character, если известны (как у `lsp` action references).
 */
export const findReferencesTool: ToolDefinition = {
	name: 'find_references',
	description: 'Кто вызывает / ссылается на символ: vscode.executeReferenceProvider (+ definition). Передай path+line+character (0-based) или path+symbol для поиска объявления.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Файл в workspace, где объявлен или используется символ',
			},
			line: {
				type: 'integer',
				description: 'Строка 0-based (если задана вместе с character)',
			},
			character: {
				type: 'integer',
				description: 'Колонка 0-based',
			},
			symbol: {
				type: 'string',
				description: 'Имя символа - найти selectionRange через document symbols, если нет line/character',
			},
			include_definition: {
				type: 'boolean',
				description: 'Также вернуть definition (по умолчанию true)',
			},
		},
		required: ['path'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path'));
		const doc = await vscode.workspace.openTextDocument(resolved.uri);

		let line = asOptionalInt(args, 'line');
		let character = asOptionalInt(args, 'character');
		const symbol = asString(args, 'symbol', '').trim();
		const includeDefinition = args.include_definition !== false;

		if ((line === undefined || character === undefined) && symbol) {
			const symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined>('vscode.executeDocumentSymbolProvider', doc.uri);

			const q = symbol.toLowerCase();
			let found: vscode.Position | undefined;

			const walk = (items: vscode.DocumentSymbol[]): void => {
				for (const s of items) {
					if (found) {
						return;
					}

					if (s.name.toLowerCase() === q || s.name.toLowerCase().includes(q)) {
						found = s.selectionRange.start;
						return;
					}

					if (s.children?.length) {
						walk(s.children);
					}
				}
			};

			for (const sym of symbols ?? []) {
				if (found) {
					break;
				}
				if (sym instanceof vscode.DocumentSymbol) {
					walk([sym]);
				} else if (sym.name.toLowerCase() === q || sym.name.toLowerCase().includes(q)) {
					found = sym.location.range.start;
				}
			}

			if (!found) {
				// Запасной вариант: первое текстовое вхождение имени символа
				const text = doc.getText();
				const idx = text.indexOf(symbol);
				if (idx >= 0) {
					found = doc.positionAt(idx);
				}
			}

			if (!found) {
				return {
					ok: false,
					content: `find_references: символ «${symbol}» не найден в ${resolved.relative}`,
				};
			}
			line = found.line;
			character = found.character;
		}

		if (line === undefined || line < 0 || character === undefined || character < 0) {
			return {
				ok: false,
				content: 'find_references: нужен line+character (0-based) или symbol для резолва позиции',
			};
		}

		const pos = new vscode.Position(line, character);
		throwIfAborted(ctx.signal);

		const refs = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
			'vscode.executeReferenceProvider',
			doc.uri,
			pos,
		);
		const references = await enrichLocations(refs ?? []);

		let definitions: Array<Record<string, unknown>> = [];
		if (includeDefinition) {
			const defs = await vscode.commands.executeCommand<
				Array<vscode.Location | vscode.LocationLink> | undefined
			>('vscode.executeDefinitionProvider', doc.uri, pos);
			definitions = await enrichLocations(defs ?? []);
		}

		return {
			ok: true,
			path: resolved.relative,
			content: JSON.stringify(
				{
					path: resolved.relative,
					position: { line, character },
					symbol: symbol || null,
					definitionCount: definitions.length,
					definitions,
					referenceCount: references.length,
					references,
					note: 'MVP: LSP reference/definition providers; не полный call hierarchy UI',
				},
				null,
				2,
			),
		};
	},
};
