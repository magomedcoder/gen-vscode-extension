// Правило строкового литерала
export interface StringRule {
	open: string;
	close: string;
	escape?: boolean; // Экранирование через `\`, по умолчанию true
	doubledEscape?: boolean; // Удвоение закрывающего символа как escape (SQL `''`)
}

// Блочный комментарий
export interface BlockRule {
	open: string;
	close: string;
	atLineStart?: boolean; // Только с начала строки (после пробелов), напр. Ruby `=begin`
}

// Конфиг синтаксиса комментариев/строк для семейства языков
export interface CommentStyleConfig {
	line: string[];
	block: BlockRule[];
	strings: StringRule[];
}

export type CommentStyleId = | 'tsStyle' | 'hash' | 'html' | 'sql' | 'lua' | 'php';
