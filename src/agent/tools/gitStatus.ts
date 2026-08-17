import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGENT_LIMITS, previewText } from '../policy';
import { asString, type ToolContext, type ToolDefinition, type ToolResult } from '../types';
import { resolveWorkspacePath, throwIfAborted } from '../workspacePath';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
	const { stdout, stderr } = await execFileAsync('git', args, {
		cwd,
		timeout: 8_000,
		maxBuffer: AGENT_LIMITS.maxGitOutput,
		signal,
	});
	return `${stdout}${stderr}`.trim();
}

export const gitStatusTool: ToolDefinition = {
	name: 'git_status',
	description: 'Только чтение: git status и краткий diff --stat. Без commit/push.',
	parameters: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Каталог или файл workspace (по умолчанию корень)',
			},
		},
		additionalProperties: false,
	},
	async execute(args, ctx: ToolContext): Promise<ToolResult> {
		throwIfAborted(ctx.signal);
		const resolved = await resolveWorkspacePath(asString(args, 'path', '.'));
		const cwd = resolved.folder.uri.fsPath;

		try {
			const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], ctx.signal);
			const status = await git(cwd, ['status', '--porcelain=v1', '-uall'], ctx.signal);
			const stat = await git(cwd, ['diff', '--stat', 'HEAD'], ctx.signal);
			const body = [`branch: ${branch}`, 'status:', status || '(чисто)', 'diff --stat:', stat || '(нет отличий от HEAD)'].join('\n');
			return {
				ok: true,
				content: previewText(body, AGENT_LIMITS.maxGitOutput)
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (/not a git repository/i.test(msg)) {
				return {
					ok: false,
					content: 'Это не git-репозиторий'
				};
			}

			return {
				ok: false,
				content: `git: ${msg}`
			};
		}
	},
};
