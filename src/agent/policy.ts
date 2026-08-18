import * as path from 'node:path';

export const AGENT_LIMITS = {
	maxReadBytes: 200_000,
	maxWriteBytes: 400_000,
	maxListEntries: 200,
	maxSearchFiles: 80,
	maxSearchMatches: 60,
	maxConfirmPreview: 800,
	maxDiagnostics: 50,
	maxGitOutput: 8_000,
	maxCommandOutput: 16_000,
	defaultCommandTimeoutMs: 60_000,
	maxCommandTimeoutMs: 300_000,
	maxWorkspaceEdits: 20,
	maxSelectionChars: 2_000,
} as const;

const DENIED_SEGMENTS = new Set(['node_modules', '.git', '.svn', '.hg']);
const DENIED_BASENAME = /^(?:\.env(?:\..+)?|credentials\.json|secrets\.json|id_rsa|id_ed25519|id_ecdsa|\.npmrc|\.pypirc|\.netrc)$/i;
const DENIED_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.ppk']);

export class PathPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PathPolicyError';
	}
}

export function pathIsInside(child: string, parent: string): boolean {
	const rel = path.relative(path.resolve(parent), path.resolve(child));
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function toPosixRelative(relativePath: string): string {
	return relativePath.split(path.sep).join('/');
}

export function isDeniedRelativePath(relativePosix: string): boolean {
	const parts = relativePosix.split('/').filter(Boolean);
	if (parts.some((part) => DENIED_SEGMENTS.has(part))) {
		return true;
	}

	const base = parts[parts.length - 1] ?? '';
	if (DENIED_BASENAME.test(base)) {
		return true;
	}
	
	const ext = path.posix.extname(base).toLowerCase();
	return DENIED_EXTENSIONS.has(ext);
}

export function findContainingFolder(fsPath: string, folderFsPaths: string[]): string | undefined {
	const resolved = path.resolve(fsPath);
	let best: string | undefined;
	for (const folder of folderFsPaths) {
		const root = path.resolve(folder);
		if (!pathIsInside(resolved, root)) {
			continue;
		}

		if (!best || root.length > best.length) {
			best = root;
		}
	}

	return best;
}

export function resolveAgainstFolders(input: string, folderFsPaths: string[]): { fsPath: string; folder: string } {
	if (folderFsPaths.length === 0) {
		throw new PathPolicyError('Нет открытого workspace');
	}

	const trimmed = input.trim() || '.';
	const folders = folderFsPaths.map((f) => path.resolve(f));

	if (path.isAbsolute(trimmed)) {
		const folder = findContainingFolder(trimmed, folders);
		if (!folder) {
			throw new PathPolicyError('Путь вне workspace');
		}

		return {
			fsPath: path.resolve(trimmed),
			folder
		};
	}

	const first = folders[0];
	const candidate = path.resolve(first, trimmed);
	const folder = findContainingFolder(candidate, folders);
	if (!folder) {
		throw new PathPolicyError('Путь вне workspace');
	}

	return {
		fsPath: candidate,
		folder
	};
}

export function assertAllowedPath(fsPath: string, folder: string): string {
	if (!pathIsInside(fsPath, folder)) {
		throw new PathPolicyError('Путь вне workspace');
	}

	const relative = toPosixRelative(path.relative(folder, fsPath));
	if (isDeniedRelativePath(relative)) {
		throw new PathPolicyError(`Путь запрещён политикой: ${relative || '.'}`);
	}

	return relative || '.';
}

export function previewText(text: string, max: number = AGENT_LIMITS.maxConfirmPreview): string {
	if (text.length <= max) {
		return text;
	}

	return `${text.slice(0, max)}\n... [обрезано ${text.length - max} символов]`;
}

export function looksBinary(bytes: Uint8Array): boolean {
	const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
	return sample.includes(0);
}
