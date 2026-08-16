export class PatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PatchError';
	}
}

export function applySearchReplace(content: string, oldString: string, newString: string, replaceAll: boolean): { text: string; count: number } {
	if (!oldString) {
		throw new PatchError('old_string не должен быть пустым - для нового файла используйте write_file');
	}

	if (oldString === newString) {
		throw new PatchError('old_string и new_string совпадают - правок нет');
	}

	let count = 0;
	let from = 0;
	while (from <= content.length) {
		const idx = content.indexOf(oldString, from);
		if (idx === -1) {
			break;
		}

		count += 1;
		from = idx + oldString.length;
	}

	if (count === 0) {
		throw new PatchError('Фрагмент old_string не найден в файле');
	}

	if (count > 1 && !replaceAll) {
		throw new PatchError(`Найдено ${count} вхождений old_string - уточните фрагмент или включите replace_all`);
	}

	const text = replaceAll
		? content.split(oldString).join(newString)
		: content.replace(oldString, newString);

	return { 
		text,
		count: replaceAll ? count : 1
	};
}
