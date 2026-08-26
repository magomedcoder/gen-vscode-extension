import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

export const GEN_DIR_RELATIVE = '.gen';
export const GEN_CONFIG_RELATIVE = '.gen/config.json';
export const GEN_CONFIG_VERSION = 1;

export interface GenProjectConfig {
	version: number;
	createdAt: string;
}

function folderFsPath(explicit?: string): string | undefined {
	return explicit ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Маркер согласия: файл `.gen/config.json` должен существовать
export async function isProjectEnabled(folderPath?: string): Promise<boolean> {
	const root = folderFsPath(folderPath);
	if (!root) {
		return false;
	}

	try {
		await fs.access(path.join(root, GEN_CONFIG_RELATIVE));
		return true;
	} catch {
		return false;
	}
}

export async function enableProject(folderPath?: string): Promise<vscode.WorkspaceFolder | undefined> {
	const folder = folderPath? vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === folderPath) : vscode.workspace.workspaceFolders?.[0];

	if (!folder) {
		return undefined;
	}

	const root = folder.uri.fsPath;
	await fs.mkdir(path.join(root, GEN_DIR_RELATIVE), { 
		recursive: true 
	});

	const configPath = path.join(root, GEN_CONFIG_RELATIVE);
	try {
		await fs.access(configPath);
	} catch {
		const config: GenProjectConfig = {
			version: GEN_CONFIG_VERSION,
			createdAt: new Date().toISOString(),
		};
		await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
	}

	return folder;
}
