import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { AGENT_LIMITS, previewText } from '../../policy';
import type { ToolContext, ToolDefinition, ToolResult } from '../../types';
import { throwIfAborted } from '../../workspacePath';
import { listIndexableFiles } from '../../../index/scanner';
import { pathsFromGitPorcelain, suggestRelatedTests } from './testImpactCore';

const execFileAsync = promisify(execFile);

// По путям или git dirty - предложить связанные *test* / __tests__ файлы
export const testImpactTool: ToolDefinition = {
	name: 'test_impact',
	description: 'По списку путей или git dirty предложить связанные тесты (*test*, *spec*, __tests__/). Не запускает тесты.',
	parameters: {
		type: 'object',
		properties: {
			paths: {
				type: 'array',
				items: { type: 'string' },
				description: 'Изменённые/интересующие пути (если пусто - git status --porcelain)',
			},
			use_git_dirty: {
				type: 'boolean',
				description: 'Взять dirty из git (по умолчанию true, если paths пуст)',
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return {
				ok: false,
				content: 'test_impact: нет workspace folder',
			};
		}

		const explicit = Array.isArray(args.paths)
			? args.paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
			: [];

		let changed = explicit.map((p) => p.replace(/\\/g, '/'));
		let source: 'paths' | 'git' = 'paths';

		const useGit = args.use_git_dirty === true || (changed.length === 0 && args.use_git_dirty !== false);
		if (changed.length === 0 && useGit) {
			try {
				const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-uall'], {
					cwd: folder.uri.fsPath,
					timeout: 8_000,
					maxBuffer: AGENT_LIMITS.maxGitOutput,
					signal: ctx.signal,
				});
				changed = pathsFromGitPorcelain(stdout);
				source = 'git';
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					ok: false,
					content: /not a git repository/i.test(msg)
						? 'test_impact: не git-репозиторий; передай paths явно'
						: `test_impact: git: ${msg}`,
				};
			}
		}

		if (changed.length === 0) {
			return {
				ok: true,
				content: JSON.stringify({ 
					source, 
					changed: [], 
					relatedTests: [], 
					note: 'Нет изменённых путей' 
				}, null, 2),
			};
		}

		const all = (await listIndexableFiles(folder)).map((f) => f.relative);
		const relatedTests = suggestRelatedTests(changed, all);

		return {
			ok: true,
			content: previewText(
				JSON.stringify(
					{
						source,
						changed: changed.slice(0, 80),
						relatedTests,
						hint: relatedTests.length
							? 'Проверь эти тесты через run_tests или run_command'
							: 'Связанные тесты не найдены эвристикой',
					},
					null,
					2,
				),
				12_000,
			),
		};
	},
};
