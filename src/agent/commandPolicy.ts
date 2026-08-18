import * as path from 'node:path';

export class CommandPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CommandPolicyError';
	}
}

const ALLOWED_BINARIES = new Set(['npm', 'yarn', 'pnpm', 'node', 'npx', 'go', 'cargo', 'rustc', 'python', 'python3', 'pytest', 'make', 'deno', 'bun', 'vitest', 'jest', 'mocha']);
const GO_SUBCOMMANDS = new Set(['test', 'vet', 'fmt', 'build', 'list', 'version', 'env']);
const NPM_ALLOWED = new Set(['test', 'run', 'exec']);
const PACKAGE_MANAGER_ALLOWED = new Set(['test', 'run']);
const PACKAGE_MANAGER_DENIED = new Set(['install', 'ci', 'publish', 'uninstall', 'link', 'unlink', 'dedupe', 'audit', 'fund', 'add', 'remove', 'global']);
const NODE_DENIED_FLAGS = new Set(['-e', '--eval', '-r', '--require', '-p', '--print']);
const PYTHON_DENIED_FLAGS = new Set(['-c', '-m']);

export function normalizeBinaryName(command: string): string {
	const base = path.basename(command.trim()).toLowerCase();
	return base.replace(/\.(cmd|exe|bat)$/i, '');
}

export function assertAllowedCommand(command: string, args: string[]): void {
	const binary = normalizeBinaryName(command);
	if (!binary) {
		throw new CommandPolicyError('Пустая команда');
	}

	if (!ALLOWED_BINARIES.has(binary)) {
		throw new CommandPolicyError(`Команда не в allowlist: ${command}. Разрешены: ${[...ALLOWED_BINARIES].sort().join(', ')}`);
	}

	for (const arg of args) {
		if (typeof arg !== 'string') {
			throw new CommandPolicyError('Аргументы должны быть строками');
		}

		if (arg.includes('\0')) {
			throw new CommandPolicyError('Недопустимый символ в аргументе');
		}
	}

	if (binary === 'go') {
		const sub = args[0];
		if (!sub || !GO_SUBCOMMANDS.has(sub)) {
			throw new CommandPolicyError(`go: разрешены только ${[...GO_SUBCOMMANDS].join(', ')}`);
		}
	}

	if (binary === 'npm' || binary === 'yarn' || binary === 'pnpm') {
		const sub = args[0];
		if (!sub) {
			throw new CommandPolicyError(`${binary}: нужен подкомандный аргумент (например test или run)`);
		}

		if (PACKAGE_MANAGER_DENIED.has(sub)) {
			throw new CommandPolicyError(`${binary} ${sub} запрещён политикой`);
		}

		if (binary === 'npm' && !NPM_ALLOWED.has(sub)) {
			throw new CommandPolicyError(`npm: разрешены только ${[...NPM_ALLOWED].join(', ')}`);
		}

		if ((binary === 'yarn' || binary === 'pnpm') && !PACKAGE_MANAGER_ALLOWED.has(sub)) {
			throw new CommandPolicyError(`${binary}: разрешены только ${[...PACKAGE_MANAGER_ALLOWED].join(', ')}`);
		}
	}

	if (binary === 'node') {
		for (const arg of args) {
			if (NODE_DENIED_FLAGS.has(arg)) {
				throw new CommandPolicyError('node: флаги -e/-r/-p запрещены');
			}
		}
	}

	if (binary === 'python' || binary === 'python3') {
		for (const arg of args) {
			if (PYTHON_DENIED_FLAGS.has(arg)) {
				throw new CommandPolicyError('python: флаги -c/-m запрещены');
			}
		}
	}
}

export function formatCommandLine(command: string, args: string[]): string {
	const parts = [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part));
	return parts.join(' ');
}
