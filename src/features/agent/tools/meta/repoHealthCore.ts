import * as path from 'node:path';

const JS_EXT = /\.(?:[cm]?[jt]s|tsx|jsx)$/i;

// Импорты ES/CJS из текста файла (эвристика, без AST)
export function extractJsImports(source: string): string[] {
	const out: string[] = [];
	const patterns = [
		/\bfrom\s+['"]([^'"]+)['"]/g,
		/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/\bimport\s+['"]([^'"]+)['"]/g,
		/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
		/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g,
	];

	for (const re of patterns) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(source)) !== null) {
			const spec = m[1]?.trim();
			if (spec) {
				out.push(spec);
			}
		}
	}

	return [...new Set(out)];
}

function stripExt(rel: string): string {
	return rel.replace(/\.(?:[cm]?[jt]s|tsx|jsx)$/i, '');
}

// Резолв относительного спецификатора к posix-пути из набора файлов
export function resolveImportSpec(
	fromFile: string,
	spec: string,
	fileSet: Set<string>,
): string | undefined {
	if (!spec.startsWith('.')) {
		return undefined;
	}

	const fromDir = path.posix.dirname(fromFile);
	const joined = path.posix.normalize(path.posix.join(fromDir, spec));
	const candidates = [
		joined,
		`${joined}.ts`,
		`${joined}.tsx`,
		`${joined}.js`,
		`${joined}.jsx`,
		`${joined}.mjs`,
		`${joined}.cjs`,
		`${joined}/index.ts`,
		`${joined}/index.tsx`,
		`${joined}/index.js`,
		`${joined}/index.jsx`,
	];

	for (const c of candidates) {
		if (fileSet.has(c)) {
			return c;
		}
	}

	const noExt = stripExt(joined);
	for (const f of fileSet) {
		if (stripExt(f) === noExt || stripExt(f) === `${noExt}/index`) {
			return f;
		}
	}

	return undefined;
}

export function buildImportGraph(files: Array<{ path: string; source: string }>): Map<string, string[]> {
	const fileSet = new Set(files.map((f) => f.path));
	const graph = new Map<string, string[]>();

	for (const file of files) {
		if (!JS_EXT.test(file.path)) {
			continue;
		}

		const deps: string[] = [];
		for (const spec of extractJsImports(file.source)) {
			const resolved = resolveImportSpec(file.path, spec, fileSet);
			if (resolved && resolved !== file.path) {
				deps.push(resolved);
			}
		}
		graph.set(file.path, [...new Set(deps)]);
	}

	return graph;
}

// Простые циклы через DFS (уникальные циклы по нормализованному ключу)
export function findImportCycles(graph: Map<string, string[]>): string[][] {
	const cycles: string[][] = [];
	const seenCycle = new Set<string>();
	const visiting = new Set<string>();
	const stack: string[] = [];

	const visit = (node: string) => {
		if (visiting.has(node)) {
			const idx = stack.indexOf(node);
			if (idx >= 0) {
				const cycle = [...stack.slice(idx), node];
				const key = [...cycle].sort().join('>');
				if (!seenCycle.has(key)) {
					seenCycle.add(key);
					cycles.push(cycle);
				}
			}
			return;
		}

		if (!graph.has(node)) {
			return;
		}

		visiting.add(node);
		stack.push(node);
		for (const next of graph.get(node) ?? []) {
			visit(next);
		}
		stack.pop();
		visiting.delete(node);
	};

	for (const node of graph.keys()) {
		visit(node);
	}

	return cycles.slice(0, 50);
}

const ENTRY_HINT = /(?:^|\/)(?:index|main|app|extension|activate)(?:\.[^/]+)?$/i;

// Файлы, на которые никто не ссылается (кроме вероятных entrypoints)
export function findOrphanFiles(graph: Map<string, string[]>): string[] {
	const imported = new Set<string>();
	for (const deps of graph.values()) {
		for (const d of deps) {
			imported.add(d);
		}
	}

	const orphans: string[] = [];
	for (const file of graph.keys()) {
		if (imported.has(file)) {
			continue;
		}
		
		if (ENTRY_HINT.test(file) || file.includes('/test/') || file.includes('.test.') || file.includes('.spec.')) {
			continue;
		}

		orphans.push(file);
	}

	return orphans.sort().slice(0, 200);
}

export function isJsLikePath(rel: string): boolean {
	return JS_EXT.test(rel);
}
