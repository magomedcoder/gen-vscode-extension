/** Короткий глиф по расширению / виду пути (UI tool cards и mention menu). */

const EXT_ICONS: Record<string, string> = {
	ts: '🟦',
	tsx: '⚛️',
	js: '🟨',
	jsx: '⚛️',
	json: '{}',
	md: '📝',
	py: '🐍',
	go: '🐹',
	rs: '🦀',
	css: '🎨',
	scss: '🎨',
	html: '🌐',
	htm: '🌐',
	svg: '🖼️',
	png: '🖼️',
	jpg: '🖼️',
	jpeg: '🖼️',
	gif: '🖼️',
	webp: '🖼️',
	ico: '🖼️',
	lock: '🔒',
	yml: '⚙️',
	yaml: '⚙️',
	sh: '💻',
	bash: '💻',
	zsh: '💻',
};

const KIND_ICONS: Record<string, string> = {
	file: '📄',
	folder: '📁',
	dir: '📁',
	codebase: '⌕',
	code: '</>',
	git: '⎇',
	branch_diff: '⇄',
	rules: '☰',
	link: '🔗',
	docs: '📖',
	agent: '◇',
	terminals: '▸',
	past: '◷',
	alias: '⌖',
	ref: '⌖',
};

// Базовое имя из пути (без завершающего `/`)
function baseName(pathOrName: string): string {
	const trimmed = pathOrName.replace(/\\/g, '/').replace(/\/+$/, '');
	const slash = trimmed.lastIndexOf('/');
	return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * Иконка по пути или имени файла.
 * Каталоги: путь с `/` на конце или явный kind `dir`.
 */
export function fileIconForPath(pathOrName: string, kind?: 'file' | 'dir' | 'folder'): string {
	const raw = pathOrName.trim();
	if (kind === 'dir' || kind === 'folder' || raw.endsWith('/')) {
		return '📁';
	}

	const name = baseName(raw).toLowerCase();
	if (name === 'package-lock.json' || name === 'yarn.lock' || name === 'pnpm-lock.yaml' || name.endsWith('.lock')) {
		return EXT_ICONS.lock!;
	}

	const dot = name.lastIndexOf('.');
	if (dot > 0 && dot < name.length - 1) {
		const ext = name.slice(dot + 1);
		if (EXT_ICONS[ext]) {
			return EXT_ICONS[ext]!;
		}
	}

	return '📄';
}

// Иконка для пункта mention-меню: kind + путь из label/insert для file/folder
export function mentionIconForSuggestion(kind: string, label: string, insert: string): string {
	if (kind === 'folder' || kind === 'dir') {
		const pathHint = label.includes('/') || !label.startsWith('@') ? label : extractPathHint(insert, label);
		return fileIconForPath(pathHint.endsWith('/') ? pathHint : `${pathHint}/`, 'folder');
	}

	if (kind === 'file') {
		return fileIconForPath(extractPathHint(insert, label));
	}

	return KIND_ICONS[kind] ?? '*';
}

// Путь из `@file path` / label
function extractPathHint(insert: string, label: string): string {
	if (label && !label.startsWith('@')) {
		return label;
	}

	const m = insert.match(/@(?:file|folder)\s+([^\s]+)/i);
	return m?.[1] ?? label;
}
