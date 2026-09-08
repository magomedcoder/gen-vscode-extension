import * as path from 'node:path';

// Эвристика: связанные тестовые файлы по имени/папке
export function suggestRelatedTests(changedPaths: string[], allFiles: string[]): string[] {
	const changed = changedPaths.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean);
	const files = allFiles.map((p) => p.replace(/\\/g, '/'));
	const hits = new Set<string>();

	for (const src of changed) {
		if (isTestPath(src)) {
			hits.add(src);
			continue;
		}

		const base = path.posix.basename(src).replace(/\.[^.]+$/, '');
		const dir = path.posix.dirname(src);
		const stem = base.replace(/\.module$/, '');

		for (const f of files) {
			if (!isTestPath(f)) {
				continue;
			}

			const fBase = path.posix.basename(f);
			const fDir = path.posix.dirname(f);

			// рядом: foo.ts -> foo.test.ts / foo.spec.ts
			if (fDir === dir && (fBase.startsWith(`${stem}.`) || fBase.startsWith(`${base}.`))) {
				hits.add(f);
				continue;
			}

			// пример: __tests__/foo.test.ts
			if (f.includes('/__tests__/') && (fBase.includes(stem) || f.includes(`/${stem}.`))) {
				hits.add(f);
				continue;
			}

			// зеркало src/ -> test/ или tests/
			const mirrored = mirrorToTestDir(src);
			if (mirrored && (f === mirrored || f.startsWith(mirrored.replace(/\.[^.]+$/, '')))) {
				hits.add(f);
				continue;
			}

			if (f.includes(stem) && (f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'))) {
				hits.add(f);
			}
		}
	}

	return [...hits].sort().slice(0, 40);
}

export function isTestPath(rel: string): boolean {
	const p = rel.replace(/\\/g, '/');
	return (
		/(?:^|\/)__tests__\//.test(p)
		|| /\.(?:test|spec)\.[^.]+$/.test(p)
		|| /(?:^|\/)tests?\//.test(p)
	);
}

function mirrorToTestDir(src: string): string | undefined {
	const p = src.replace(/\\/g, '/');
	if (p.startsWith('src/')) {
		const rest = p.slice(4);
		const noExt = rest.replace(/\.[^.]+$/, '');
		return `src/test/${noExt}.test.ts`;
	}

	return undefined;
}

// Разобрать пути из git status --porcelain
export function pathsFromGitPorcelain(porcelain: string): string[] {
	const out: string[] = [];
	for (const line of porcelain.split(/\r?\n/)) {
		if (line.length < 4) {
			continue;
		}

		// XY PATH или XY ORIG -> PATH
		const rest = line.slice(3).trim();
		const arrow = rest.includes(' -> ') ? rest.split(' -> ').pop()! : rest;
		const cleaned = arrow.replace(/^"+|"+$/g, '').trim();
		if (cleaned) {
			out.push(cleaned.replace(/\\/g, '/'));
		}
	}
	
	return [...new Set(out)];
}
