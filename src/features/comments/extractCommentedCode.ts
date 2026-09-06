// Извлекает код из ответа llm либо содержимое markdown-блока, либо сырой текст (возможна короткая преамбула)
export function extractCommentedCode(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) {
		return '';
	}

	const fences = [...trimmed.matchAll(/```(?:[\w.+-]*)?\r?\n([\s\S]*?)```/g)];
	if (fences.length > 0) {
		return stripTrailingNewline(fences[fences.length - 1][1] ?? '');
	}

	// Иногда модель открывает блок без закрытия - берём всё после первой строки ```
	const openFence = trimmed.match(/^```(?:[\w.+-]*)?\r?\n([\s\S]*)$/);
	if (openFence?.[1] !== undefined) {
		return stripTrailingNewline(openFence[1].replace(/\r?\n```\s*$/, ''));
	}

	return stripTrailingNewline(trimmed);
}

// Убирает один завершающий перевод строки
function stripTrailingNewline(text: string): string {
	return text.replace(/\r?\n$/, '');
}
