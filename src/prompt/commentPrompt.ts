import type { CommentStyle } from '../config/settings';
import type { ChatMessage } from '../llm/types';

export interface CommentPromptInput {
	languageId: string;
	fileName: string;
	code: string;
	commentStyle: CommentStyle;
}

// Подсказки по стилю комментариев
const STYLE_HINT: Record<CommentStyle, string> = {
	inline: 'Предпочти короткие строковые комментарии (// или #) над неочевидными строками.',
	block: 'Предпочти короткие блочные комментарии над неочевидными участками.',
};

// Собирает system + few-shot + user сообщения для llm
export function buildCommentMessages(input: CommentPromptInput): ChatMessage[] {
	const style = STYLE_HINT[input.commentStyle];

	const system = [
		'Ты senior-разработчик: добавляешь только полезные комментарии к коду.',
		'Пиши комментарии на русском языке.',
		style,
		'Не описывай очевидное (инкременты, простые геттеры, тривиальные присваивания).',
		'Комментируй инварианты, побочные эффекты, причины решений и edge cases.',
		'Не рефактори, не переименовывай, не переформатируй, не удаляй и не меняй исполняемый код.',
		'Сохраняй отступы и форматирование как есть.',
		'Ответь ТОЛЬКО полным прокомментированным кодом. Без markdown-ограждений, если их не было в исходнике. Без пояснений вне кода.',
	].join(' ');

	const fewShotUser = [
		'Язык: javascript',
		'Файл: example.js',
		'Добавь комментарии к коду:',
		'```javascript',
		'function canWrite(user) {',
		'  if (!user.roles.includes("admin") && user.id !== ownerId) {',
		'    return false;',
		'  }',
		'  return true;',
		'}',
		'```',
	].join('\n');

	const fewShotAssistant = [
		'function canWrite(user) {',
		'  // Не-владелец допускается только с ролью admin; владелец - всегда',
		'  if (!user.roles.includes("admin") && user.id !== ownerId) {',
		'    return false;',
		'  }',
		'  return true;',
		'}',
	].join('\n');

	const user = [
		`Язык: ${input.languageId}`,
		`Файл: ${input.fileName}`,
		'Добавь комментарии к коду. Верни только прокомментированный код:',
		`\`\`\`${input.languageId}`,
		input.code,
		'```',
	].join('\n');

	return [
		{
			role: 'system',
			content: system
		},
		{
			role: 'user',
			content: fewShotUser
		},
		{
			role: 'assistant',
			content: fewShotAssistant
		},
		{
			role: 'user',
			content: user
		},
	];
}
