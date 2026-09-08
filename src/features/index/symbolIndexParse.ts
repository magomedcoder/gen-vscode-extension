export interface SymbolIndexEntry {
	name: string;
	kind: string;
	path: string;
	startLine: number;
	endLine: number;
	containerName?: string;
}

export interface SymbolIndexDocument {
	updatedAt: string;
	fileCount: number;
	symbols: SymbolIndexEntry[];
}

// Парсинг кэша (для тестов / загрузки) - без зависимости от vscode
export function parseSymbolIndexJson(raw: string): SymbolIndexDocument | undefined {
	try {
		const parsed = JSON.parse(raw) as SymbolIndexDocument;
		if (!parsed || !Array.isArray(parsed.symbols)) {
			return undefined;
		}

		return {
			updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
			fileCount: typeof parsed.fileCount === 'number' ? parsed.fileCount : 0,
			symbols: parsed.symbols.filter((s) => s && typeof s.name === 'string' && typeof s.path === 'string'),
		};
	} catch {
		return undefined;
	}
}
