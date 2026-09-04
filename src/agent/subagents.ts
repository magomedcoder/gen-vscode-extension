export type SubagentType = 'explore' | 'general';

export interface SubagentDef {
	id: SubagentType;
	name: string;
	description: string;
	prompt: string;
	readonly: boolean;
	maxIterations: number;
}

export const BUILTIN_SUBAGENTS: SubagentDef[] = [
	{
		id: 'explore',
		name: 'Explore',
		description: 'Быстрый read-only обзор кодовой базы (grep/glob/read/search).',
		readonly: true,
		maxIterations: 12,
		prompt: [
			'Ты субагент Explore. Только исследование: list_dir, read_file, glob, grep, search_files, file_search, codebase_search, get_diagnostics.',
			'Не правь файлы и не запускай мутирующие команды.',
			'Верни краткий отчёт: найденные пути, ключевые фрагменты, выводы.',
		].join(' '),
	},
	{
		id: 'general',
		name: 'General',
		description: 'Многошаговая подзадача с полными tools (кроме вложенного task).',
		readonly: false,
		maxIterations: 20,
		prompt: [
			'Ты субагент General. Выполни порученную подзадачу автономно.',
			'Можешь читать и править файлы в рамках задачи.',
			'Не вызывай tool task повторно. В конце дай сжатый summary результата.',
		].join(' '),
	},
];

export function getSubagent(id: string): SubagentDef | undefined {
	return BUILTIN_SUBAGENTS.find((s) => s.id === id || s.name.toLowerCase() === id.toLowerCase());
}

export const DEFAULT_SUBAGENT_DEPTH = 2;
