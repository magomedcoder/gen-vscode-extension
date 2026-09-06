import { resolveCommentStyleId, type CommentStyleId } from './styles';

export interface FewShotExample {
	languageId: string;
	fileName: string;
	userCode: string;
	assistantCode: string;
}

const JS_FEW_SHOT: FewShotExample = {
	languageId: 'javascript',
	fileName: 'example.js',
	userCode: [
		'function canWrite(user) {',
		'  if (!user.roles.includes("admin") && user.id !== ownerId) {',
		'    return false;',
		'  }',
		'  return true;',
		'}',
	].join('\n'),
	assistantCode: [
		'function canWrite(user) {',
		'  // Не-владелец допускается только с ролью admin; владелец - всегда',
		'  if (!user.roles.includes("admin") && user.id !== ownerId) {',
		'    return false;',
		'  }',
		'  return true;',
		'}',
	].join('\n'),
};

const PYTHON_FEW_SHOT: FewShotExample = {
	languageId: 'python',
	fileName: 'example.py',
	userCode: [
		'def can_write(user, owner_id):',
		'    if "admin" not in user.roles and user.id != owner_id:',
		'        return False',
		'    return True',
	].join('\n'),
	assistantCode: [
		'def can_write(user, owner_id):',
		'    # Не-владелец допускается только с ролью admin',
		'    if "admin" not in user.roles and user.id != owner_id:',
		'        return False',
		'    return True',
	].join('\n'),
};

const HTML_FEW_SHOT: FewShotExample = {
	languageId: 'html',
	fileName: 'example.html',
	userCode: [
		'<section>',
		'  <h1>Title</h1>',
		'</section>',
	].join('\n'),
	assistantCode: [
		'<!-- Заголовок страницы -->',
		'<section>',
		'  <h1>Title</h1>',
		'</section>',
	].join('\n'),
};

const SQL_FEW_SHOT: FewShotExample = {
	languageId: 'sql',
	fileName: 'example.sql',
	userCode: 'SELECT id FROM users WHERE active = 1;',
	assistantCode: [
		'-- Только активные пользователи',
		'SELECT id FROM users WHERE active = 1;',
	].join('\n'),
};

const LUA_FEW_SHOT: FewShotExample = {
	languageId: 'lua',
	fileName: 'example.lua',
	userCode: [
		'local function can_write(user, owner_id)',
		'  return user.id == owner_id or user.admin',
		'end',
	].join('\n'),
	assistantCode: [
		'local function can_write(user, owner_id)',
		'  -- Владелец или admin',
		'  return user.id == owner_id or user.admin',
		'end',
	].join('\n'),
};

const PHP_FEW_SHOT: FewShotExample = {
	languageId: 'php',
	fileName: 'example.php',
	userCode: [
		'function canWrite(array $user, int $ownerId): bool {',
		'    return $user["id"] === $ownerId || in_array("admin", $user["roles"], true);',
		'}',
	].join('\n'),
	assistantCode: [
		'function canWrite(array $user, int $ownerId): bool {',
		'    // Владелец или роль admin',
		'    return $user["id"] === $ownerId || in_array("admin", $user["roles"], true);',
		'}',
	].join('\n'),
};

const FEW_SHOT_BY_STYLE: Record<CommentStyleId, FewShotExample> = {
	tsStyle: JS_FEW_SHOT,
	hash: PYTHON_FEW_SHOT,
	html: HTML_FEW_SHOT,
	sql: SQL_FEW_SHOT,
	lua: LUA_FEW_SHOT,
	php: PHP_FEW_SHOT,
};

export function pickFewShot(languageId: string): FewShotExample {
	const styleId = resolveCommentStyleId(languageId);
	return FEW_SHOT_BY_STYLE[styleId];
}

export function formatFewShotUser(example: FewShotExample): string {
	return [
		`Язык: ${example.languageId}`,
		`Файл: ${example.fileName}`,
		'Добавь комментарии к коду:',
		`\`\`\`${example.languageId}`,
		example.userCode,
		'```',
	].join('\n');
}
