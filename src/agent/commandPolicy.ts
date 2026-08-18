import * as path from 'node:path';

export class CommandPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CommandPolicyError';
	}
}

const DENIED_BINARIES = new Set(['sudo', 'doas', 'su', 'rm', 'rmdir', 'unlink', 'dd', 'mkfs', 'fdisk', 'chmod', 'chown', 'chgrp', 'curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'sftp', 'docker', 'podman', 'kubectl', 'nerdctl', 'sh', 'bash', 'zsh', 'fish', 'dash', 'csh', 'tcsh', 'cmd', 'powershell', 'pwsh']);

const EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print']);
const C_FLAGS = new Set(['-c', '--command']);

const PACKAGE_SUBCOMMANDS = new Set(['install', 'ci', 'publish', 'uninstall', 'global', 'add', 'remove']);
const GIT_WRITE_SUBCOMMANDS = new Set(['push', 'rebase', 'reset', 'commit', 'tag', 'filter-branch']);

export function normalizeBinaryName(command: string): string {
	const base = path.basename(command.trim()).toLowerCase();
	return base.replace(/\.(cmd|exe|bat)$/i, '');
}

function looksLikeFileOperand(arg: string): boolean {
	if (arg.startsWith('-') || /[\s;`$(){}|&<>]/.test(arg)) {
		return false;
	}

	return /[\\/]/.test(arg) || /\.\w{1,10}$/.test(arg);
}

function isDeniedCFlag(binary: string, args: string[], index: number): boolean {
	if (!C_FLAGS.has(args[index])) {
		return false;
	}

	if (binary === 'git') {
		return false;
	}

	const next = args[index + 1];
	if (next === undefined) {
		return true;
	}

	if (next.startsWith('-')) {
		return false;
	}

	return !looksLikeFileOperand(next);
}

function firstSubcommand(args: string[]): string | undefined {
	for (const arg of args) {
		if (!arg.startsWith('-')) {
			return arg.toLowerCase();
		}
	}

	return undefined;
}

function gitSubcommand(args: string[]): string | undefined {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === '-C' || arg === '--git-dir' || arg === '--work-tree' || arg === '-c') {
			i += 1;
			continue;
		}

		if (arg.startsWith('-')) {
			continue;
		}

		return arg.toLowerCase();
	}

	return undefined;
}

export function assertAllowedCommand(command: string, args: string[]): void {
	const trimmed = command.trim();
	if (!trimmed) {
		throw new CommandPolicyError('Пустая команда');
	}

	if (trimmed.includes('..') || trimmed.includes('\0')) {
		throw new CommandPolicyError('Недопустимый путь к команде');
	}

	const binary = normalizeBinaryName(trimmed);
	if (!binary) {
		throw new CommandPolicyError('Пустая команда');
	}

	if (DENIED_BINARIES.has(binary)) {
		throw new CommandPolicyError(`Команда запрещена политикой: ${binary}`);
	}

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (typeof arg !== 'string') {
			throw new CommandPolicyError('Аргументы должны быть строками');
		}

		if (arg.includes('\0')) {
			throw new CommandPolicyError('Недопустимый символ в аргументе');
		}

		if (EVAL_FLAGS.has(arg) || isDeniedCFlag(binary, args, i)) {
			throw new CommandPolicyError(`Флаг ${arg} запрещён политикой (eval)`);
		}
	}

	const sub = binary === 'git' ? gitSubcommand(args) : firstSubcommand(args);
	if (sub && PACKAGE_SUBCOMMANDS.has(sub)) {
		throw new CommandPolicyError(`Подкоманда ${sub} запрещена политикой`);
	}

	if (binary === 'git' && sub && GIT_WRITE_SUBCOMMANDS.has(sub)) {
		throw new CommandPolicyError(`git ${sub} запрещён. Для статуса используйте git_status`);
	}
}

export function formatCommandLine(command: string, args: string[]): string {
	const parts = [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part));
	return parts.join(' ');
}
