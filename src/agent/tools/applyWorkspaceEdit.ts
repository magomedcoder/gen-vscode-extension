import * as vscode from 'vscode';
import { formatMiniDiff } from '../diff';
import { applySearchReplace } from '../patch';
import { AGENT_LIMITS } from '../policy';
import { asBoolean, asObjectArray, asString} from '../types';
import type { ToolContext, ToolDefinition, ToolResult } from '../types';
import { resolveWorkspacePath, throwIfAborted } from '../workspacePath';
import { confirmAlwaysOrSkip, confirmOrSkip, shouldConfirmWrites } from './confirm';

export interface SearchReplaceEdit {
	path: string;
	old_string: string;
	new_string: string;
	replace_all: boolean;
}

export function parseWorkspaceEdits(args: Record<string, unknown>): SearchReplaceEdit[] {
	return asObjectArray(args, 'edits').map((item) => ({
		path: asString(item, 'path'),
		old_string: asString(item, 'old_string'),
		new_string: asString(item, 'new_string'),
		replace_all: asBoolean(item, 'replace_all'),
	}));
}

export const applyWorkspaceEditTool: ToolDefinition = {
	name: 'apply_workspace_edit',
	description: 'Несколько точечных правок (old_string -> new_string) атомарно через WorkspaceEdit. Либо все применятся, либо ни одна.',
	parameters: {
		type: 'object',
		properties: {
			edits: {
				type: 'array',
				description: 'Список правок',
				items: {
					type: 'object',
					properties: {
						path: {
							type: 'string'
						},
						old_string: {
							type: 'string'
						},
						new_string: {
							type: 'string'

						},
						replace_all: {
							type: 'boolean'

						},
					},
					required: ['path', 'old_string', 'new_string'],
				},
			},
		},
		required: ['edits'],
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const parsed = parseWorkspaceEdits(args);
		if (parsed.length === 0) {
			return {
				ok: false,
				content: 'Нужен непустой массив edits'
			};
		}

		if (parsed.length > AGENT_LIMITS.maxWorkspaceEdits) {
			return {
				ok: false,
				content: `Слишком много правок (${parsed.length}, лимит ${AGENT_LIMITS.maxWorkspaceEdits})`,
			};
		}

		type Prepared = {
			old_string: string;
			new_string: string;
			replace_all: boolean;
			uri: vscode.Uri;
			relative: string;
			original: string;
			text: string;
			count: number;
			userDiff?: string;
		};

		const prepared: Prepared[] = [];

		for (const item of parsed) {
			throwIfAborted(ctx.signal);
			if (!item.path || !item.old_string) {
				return {
					ok: false,
					content: 'У каждой правки нужны path и old_string',
				};
			}

			const resolved = await resolveWorkspacePath(item.path);
			const doc = await vscode.workspace.openTextDocument(resolved.uri);
			const original = doc.getText();
			let next: { text: string; count: number };
			try {
				next = applySearchReplace(original, item.old_string, item.new_string, item.replace_all);
			} catch (err) {
				return {
					ok: false,
					content: `${resolved.relative}: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
			if (new TextEncoder().encode(next.text).byteLength > AGENT_LIMITS.maxWriteBytes) {
				return {
					ok: false,
					content: `Результат слишком большой: ${resolved.relative}`,
				};
			}

			prepared.push({
				old_string: item.old_string,
				new_string: item.new_string,
				replace_all: item.replace_all,
				uri: doc.uri,
				relative: resolved.relative,
				original,
				text: next.text,
				count: next.count,
				userDiff: ctx.writes?.userDiff(doc.uri, original),
			});
		}

		const drifted = prepared.filter((p) => p.userDiff);
		if (drifted.length > 0) {
			const detail = drifted.map((p) => `${p.relative}:\n${p.userDiff}`).join('\n\n');
			const denied = await confirmAlwaysOrSkip(
				ctx,
				vscode.l10n.t('agent.overwriteUserEditsBatchTitle', drifted.length),
				`${vscode.l10n.t('agent.overwriteUserEditsDetail')}\n\n${detail}`,
			);
			if (denied) {
				return {
					...denied,
					path: prepared.map((p) => p.relative).join(', '),
				};
			}
		} else if (shouldConfirmWrites()) {
			const summary = prepared.map((p) => `${p.relative} (${p.count} замен)`).join('\n');
			const denied = await confirmOrSkip(ctx, `Применить ${prepared.length} правок атомарно?`, summary);
			if (denied) {
				return {
					...denied,
					path: prepared.map((p) => p.relative).join(', '),
				};
			}
		}

		const refreshed: Array<{
			uri: vscode.Uri;
			relative: string;
			range: vscode.Range;
			original: string;
			text: string;
			count: number;
		}> = [];

		for (const item of prepared) {
			throwIfAborted(ctx.signal);
			const doc = await vscode.workspace.openTextDocument(item.uri);
			const original = doc.getText();
			let next: { text: string; count: number };
			try {
				next = applySearchReplace(original, item.old_string, item.new_string, item.replace_all);
			} catch (err) {
				return {
					ok: false,
					path: item.relative,
					content: `${item.relative}: ${err instanceof Error ? err.message : String(err)} (файл изменился - сделай read_file и повтори)`,
				};
			}

			const last = Math.max(0, doc.lineCount - 1);
			refreshed.push({
				uri: doc.uri,
				relative: item.relative,
				range: new vscode.Range(0, 0, last, doc.lineAt(last).text.length),
				original,
				text: next.text,
				count: next.count,
			});
		}

		const ws = new vscode.WorkspaceEdit();
		for (const item of refreshed) {
			ws.replace(item.uri, item.range, item.text);
		}

		const ok = await vscode.workspace.applyEdit(ws);
		if (!ok) {
			return {
				ok: false,
				content: 'WorkspaceEdit не применён',
			};
		}

		if (ctx.revealFile && refreshed[0]) {
			await ctx.revealFile(refreshed[0].uri);
		}

		for (const item of refreshed) {
			await ctx.checkpoint?.remember(item.uri, item.relative, item.original);
			ctx.writes?.remember(item.uri, item.relative, item.text);
			ctx.trackMutation?.(item.uri);
		}

		const note = drifted.length > 0 ? '\nУчтены правки пользователя на части файлов.' : '';
		return {
			ok: true,
			path: refreshed.map((p) => p.relative).join(', '),
			diff: refreshed.map((p) => `--- ${p.relative}\n${formatMiniDiff(p.original, p.text)}`).join('\n\n'),
			content: `Применено правок: ${refreshed.length}\n${refreshed.map((p) => `${p.relative}: ${p.count}`).join('\n')}${note}`,
		};
	},
};
