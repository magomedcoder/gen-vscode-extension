export interface ValidationResult {
	ok: boolean;
	message?: string;
}

// Убирает комментарии и сравнивает нормализованный код чтобы поймать случаи, когда llm изменила логику, а не только добавила комментарии
export function validateUnchangedCode(original: string, commented: string, languageId: string): ValidationResult {
	const a = normalizeCode(stripComments(original, languageId));
	const b = normalizeCode(stripComments(commented, languageId));

	if (a === b) {
		return { ok: true };
	}

	return {
		ok: false,
		message: 'Модель изменила код (не только комментарии). Проверьте diff перед применением.',
	};
}

// Удаляет комментарии с учётом языка файла
export function stripComments(source: string, _languageId: string): string {
	return stripCStyleComments(source);
}

// Нормализация пробелов для сравнения
function normalizeCode(code: string): string {
	return code.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/g, ''))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

// Снятие строковых и блочных C-style комментариев без порчи строк
function stripCStyleComments(source: string): string {
	let result = '';
	let i = 0;
	let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tq' = 'code';

	while (i < source.length) {
		const ch = source[i];
		const next = source[i + 1];

		if (state === 'code') {
			if (ch === '/' && next === '/') {
				state = 'line';
				i += 2;
				continue;
			}

			if (ch === '/' && next === '*') {
				state = 'block';
				i += 2;
				continue;
			}

			if (ch === "'") {
				state = 'sq';
				result += ch;
				i += 1;
				continue;
			}

			if (ch === '"') {
				state = 'dq';
				result += ch;
				i += 1;
				continue;
			}

			if (ch === '`') {
				state = 'tq';
				result += ch;
				i += 1;
				continue;
			}

			result += ch;
			i += 1;
			continue;
		}

		if (state === 'line') {
			if (ch === '\n') {
				state = 'code';
				result += ch;
			}
			i += 1;
			continue;
		}

		if (state === 'block') {
			if (ch === '*' && next === '/') {
				state = 'code';
				i += 2;
				continue;
			}
			i += 1;
			continue;
		}

		// состояния строк
		if (ch === '\\' && i + 1 < source.length) {
			result += ch + source[i + 1];
			i += 2;
			continue;
		}

		if (state === 'sq' && ch === "'") {
			state = 'code';
		} else if (state === 'dq' && ch === '"') {
			state = 'code';
		} else if (state === 'tq' && ch === '`') {
			state = 'code';
		}

		result += ch;
		i += 1;
	}

	return result;
}
