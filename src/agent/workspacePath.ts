import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { assertAllowedPath, findContainingFolder, PathPolicyError, pathIsInside, resolveAgainstFolders } from './policy';

export interface ResolvedWorkspacePath {
	uri: vscode.Uri;
	fsPath: string;
	relative: string;
	folder: vscode.WorkspaceFolder;
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
		throw new PathPolicyError('Нет открытого workspace');
	}

	return best;
}

async function followToWorkspace(fsPath: string, folders: string[]): Promise<string> {
	try {
		const real = await fs.realpath(fsPath);
		if (!findContainingFolder(real, folders)) {
			throw new PathPolicyError('Путь вне workspace (в т.ч. после перехода по symlink)');
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
				throw new PathPolicyError('Путь вне workspace (в т.ч. после перехода по symlink)');
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
	const { fsPath, folder } = resolveAgainstFolders(input, folders);
	const checked = await followToWorkspace(fsPath, folders);
	const containing = findContainingFolder(checked, folders) ?? folder;
	const relative = assertAllowedPath(checked, containing);
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

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		const err = new Error('Операция отменена');
		err.name = 'AbortError';
		throw err;
	}
}
