import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSettings } from '../config/settings';
import { isIgnoredByGitIgnore } from './gitIgnore';
import { assertAllowedPath, findContainingFolder, PathPolicyError, pathIsInside, resolveAgainstFolders } from './policy';

export interface ResolvedWorkspacePath {
	uri: vscode.Uri;
	fsPath: string;
	relative: string;
	folder: vscode.WorkspaceFolder;
	// Путь вне workspace (только если allowExternalDirectory)
	outside?: boolean;
}

function workspaceFolderPaths(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

function folderContaining(fsPath: string): vscode.WorkspaceFolder {
	const folders = vscode.workspace.workspaceFolders ?? [];
	let best: vscode.WorkspaceFolder | undefined;
	for (const folder of folders) {
		if (!pathIsInside(fsPath, folder.uri.fsPath)) {
			continue;
		}

		if (!best || folder.uri.fsPath.length > best.uri.fsPath.length) {
			best = folder;
		}
	}
	if (!best) {
		throw new PathPolicyError(vscode.l10n.t('policy.noWorkspace'));
	}

	return best;
}

function firstWorkspaceFolder(): vscode.WorkspaceFolder {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new PathPolicyError(vscode.l10n.t('policy.noWorkspace'));
	}

	return folder;
}

async function followToWorkspace(fsPath: string, folders: string[]): Promise<string> {
	try {
		const real = await fs.realpath(fsPath);
		if (!findContainingFolder(real, folders)) {
			throw new PathPolicyError(vscode.l10n.t('policy.pathOutsideSymlink'));
		}

		return real;
	} catch (err) {
		if (err instanceof PathPolicyError) {
			throw err;
		}
		const parent = path.dirname(fsPath);
		try {
			const realParent = await fs.realpath(parent);
			const candidate = path.join(realParent, path.basename(fsPath));
			if (!findContainingFolder(candidate, folders)) {
				throw new PathPolicyError(vscode.l10n.t('policy.pathOutsideSymlink'));
			}

			return candidate;
		} catch (inner) {
			if (inner instanceof PathPolicyError) {
				throw inner;
			}
			
			return path.resolve(fsPath);
		}
	}
}

export async function resolveWorkspacePath(input: string): Promise<ResolvedWorkspacePath> {
	const folders = workspaceFolderPaths();
	const allowOutside = getSettings().allowExternalDirectory;
	const { fsPath, folder, outside } = resolveAgainstFolders(input, folders, { allowOutside });

	// external_directory: вне workspace - без symlink/gitignore sandbox
	if (outside) {
		const uri = vscode.Uri.file(path.resolve(fsPath));
		return {
			uri,
			fsPath: uri.fsPath,
			relative: uri.fsPath,
			folder: firstWorkspaceFolder(),
			outside: true,
		};
	}

	const checked = await followToWorkspace(fsPath, folders);
	const containing = findContainingFolder(checked, folders) ?? folder;
	const relative = assertAllowedPath(checked, containing);
	if (await isIgnoredByGitIgnore(containing, relative)) {
		throw new PathPolicyError(vscode.l10n.t('policy.pathIgnored', relative || '.'));
	}

	const uri = vscode.Uri.file(checked);
	return {
		uri,
		fsPath: uri.fsPath,
		relative,
		folder: folderContaining(checked),
	};
}

export async function pathExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

export async function relativeFromUri(uri: vscode.Uri): Promise<string> {
	if (uri.scheme === 'untitled') {
		return uri.path || 'untitled';
	}

	try {
		return (await resolveWorkspacePath(uri.fsPath)).relative;
	} catch {
		return uri.fsPath;
	}
}

export async function resolveCommandCwd(input: string): Promise<ResolvedWorkspacePath & { cwd: string }> {
	const resolved = await resolveWorkspacePath(input);
	try {
		const stat = await vscode.workspace.fs.stat(resolved.uri);
		if (stat.type & vscode.FileType.Directory) {
			return {
				...resolved,
				cwd: resolved.fsPath
			};
		}
	} catch {}

	return {
		...resolved,
		cwd: path.dirname(resolved.fsPath),
		relative: path.posix.dirname(resolved.relative) || '.',
	};
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		const err = new Error(vscode.l10n.t('agent.operationCancelled'));
		err.name = 'AbortError';
		throw err;
	}
}
