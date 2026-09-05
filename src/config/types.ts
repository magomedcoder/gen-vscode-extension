import type { ApprovalPolicy } from './approvalTypes';
import { DEFAULT_APPROVAL_POLICY } from './approvalTypes';

export type ChatMode = 'ask' | 'agent' | 'debug' | 'design' | 'plan' | 'multitask';
export type AgentAuthLevel = 'auto' | 'ask' | 'open';
export type CommentStyle = 'inline' | 'block';

// Режимы с tool-calling (не «просто чат»)
export function isAgentLikeMode(mode: ChatMode): boolean {
	return mode === 'agent' || mode === 'debug' || mode === 'design' || mode === 'plan' || mode === 'multitask';
}

export interface GenSettings {
	baseUrl: string;
	model: string;
	/**
	 * Дешёвая модель для title / summary / compaction (пусто - как основная).
	 */
	smallModel: string;
	/**
	 * Режим чата по умолчанию: ask / agent / debug / design / plan / multitask
	 */
	chatMode: ChatMode;
	/**
	 * Максимум итераций agent loop (LLM -> tools -> LLM)
	 *
	 * 0 - без лимита
	 * min - 0
	 * max - 40
	 * default - 40
	 */
	agentMaxIterations: number;
	/**
	 * Чтение - только просмотр; Спросить - подтверждать правки; Без спроса - без диалогов, всё в лог.
	 */
	agentAuthLevel: AgentAuthLevel;
	/**
	 * Политика подтверждений по типам действий (shell / edits / delete / mcp / ...)
	 */
	approvalPolicy: ApprovalPolicy;
	/**
	 * Авто-одобрять ask (deny остаётся deny)
	 */
	autoApprove: boolean;
	/**
	 * Не рвать agent loop после deny - вернуть причину модели и продолжить
	 */
	continueLoopOnDeny: boolean;
	/**
	 * Подмешивать контекст workspace в prompt
	 */
	enableWorkspaceContext: boolean;
	/**
	 * Always-on: короткая сводка (git status -sb, недавние файлы) в каждый turn.
	 */
	alwaysOnWorkspaceContext: boolean;
	/**
	 * Показать vscode notification, когда ход агента завершён.
	 */
	notifyOnComplete: boolean;
	/**
	 * Разрешить чтение файлов tools
	 */
	enableFileReading: boolean;
	/**
	 * Разрешить терминал / run_command
	 */
	enableTerminal: boolean;
	/**
	 * Разрешить web_search
	 */
	webSearchEnabled: boolean;
	/**
	 * Разрешить fetch_page / @link
	 */
	webFetchEnabled: boolean;
	/**
	 * Доп. system prompt для чата/агента (поверх правил проекта)
	 */
	systemPrompt: string;
	/**
	 * Температура
	 *
	 * min - 0,
	 * max - 2,
	 *
	 * default - 0.2
	 *
	 * лучше держать низкой для стабильного формата
	 */
	temperature: number;
	/**
	 * Максимум токенов в ответе модели
	 *
	 * min - 64
	 *
	 * default - 8192
	 */
	maxTokens: number;
	/**
	 * Оценка размера контекстного окна (для context ring в шапке чата).
	 * default - 128000
	 */
	maxContextTokens: number;
	/**
	 * Таймаут HTTP-запроса в миллисекундах
	 *
	 * min - 1000
	 *
	 * default - 120000
	 */
	requestTimeoutMs: number;
	/**
	 * Максимальное количество символов на входе
	 *
	 * min - 500
	 *
	 * default - 8000
	 */
	maxInputChars: number;
	/**
	 * Стиль комментариев
	 *
	 * inline - короткие строковые комментарии
	 * block - короткие блочные комментарии
	 */
	commentStyle: CommentStyle;
	previewBeforeApply: boolean;
	/**
	 * Дополнительные инструкции к system prompt для комментариев.
	 * Пусто - только стандартный prompt
	 */
	commentSystemPrompt: string;
	/**
	 * Glob-шаблоны запрещённых путей (по одному на строку).
	 * Пусто - ничего не запрещать. 
	 * На первом запуске НЕ автозаполняем (см. EXAMPLE_DENIED_PATHS).
	 * Для `.env*` по умолчанию используй `sensitivePathPatterns`, а не этот список.
	 */
	deniedPaths: string[];
	/**
	 * Glob’ы чувствительных путей: запись/удаление всегда ask (или deny по политике),
	 * даже при autoApprove / session-allow. Default: `.env`, `.env.*`.
	 * Не путать с `deniedPaths` (жёсткий deny на уровне sandbox).
	 */
	sensitivePathPatterns: string[];
	/**
	 * Разрешить пути вне workspace folders (external_directory).
	 * false (default) - deny; true - resolve + approval action `outside`.
	 */
	allowExternalDirectory: boolean;
	/**
	 * Имена бинарников, запрещённых для run_command (по одному на строку).
	 * Пусто - не запрещать по имени (eval / git write / package install остаются в коде).
	 */
	deniedCommands: string[];
	/**
	 * JS-регулярки для маскировки секретов в тексте, уходящем в LLM.
	 * Пусто - не маскировать.
	 */
	secretPatterns: string[];
	/**
	 * Имя HTTP-заголовка с ключом.
	 * Пусто - Authorization.
	 */
	authHeader: string;
	/**
	 * Схема значения (Bearer).
	 * Пусто - сырой ключ без префикса.
	 */
	authScheme: string;
	/**
	 * Писать план агента в `.gen/plan.md` в workspace.
	 * Выключено - план только в памяти сессии.
	 */
	planWriteToFile: boolean;
	/**
	 * Писать логи в Output и в файлы.
	 * По умолчанию выключено.
	 */
	loggingEnabled: boolean;
	/**
	 * Максимум символов в ответе одного tool (обрезка хвоста).
	 */
	toolOutputMaxChars: number;
	/**
	 * MCP-серверы (stdio): имя, команда, args, env, cwd, timeoutMs, enabled.
	 */
	mcpServers: Array<{
		name: string;
		transport: 'stdio';
		command: string;
		args?: string[];
		env?: Record<string, string>;
		// Рабочая директория процесса MCP
		cwd?: string;
		// Таймаут JSON-RPC запроса в мс
		timeoutMs?: number;
		enabled: boolean;
	}>;
	/**
	 * Лимит вложенности tool `task` (субагенты).
	 * min - 1, max - 4, default - 2
	 */
	subagentDepth: number;
	/**
	 * Доп. каталоги skills (относительно workspace или абсолютные).
	 * Базовые: `.gen/skills`, `.agents/skills`.
	 */
	skillsPaths: string[];
	/**
	 * HTTPS URL на удалённые SKILL.md (имя из basename URL).
	 */
	skillsUrls: string[];
	/**
	 * HTTPS URL с инструкциями - текст append к project rules.
	 */
	instructionUrls: string[];
	/**
	 * Id персоны из `.gen/personas/*.md` (пусто - без персоны).
	 */
	personaId: string;
	/**
	 * После успешного write_file / apply_patch форматировать документ (editor.action.formatDocument).
	 * По умолчанию выключено.
	 */
	formatAfterEdit: boolean;
	/**
	 * Включить semantic_search / embeddings.
	 */
	indexingEnabled: boolean;
	/**
	 * Base URL для OpenAI-compatible POST /embeddings (пусто - как baseUrl).
	 */
	embeddingsBaseUrl: string;
	/**
	 * Модель эмбеддингов.
	 */
	embeddingsModel: string;
	/**
	 * Передавать картинки в chat completions как image_url (OpenAI-compatible multimodal).
	 * По умолчанию выключено: в сообщение попадает только `[image path]`.
	 */
	visionEnabled: boolean;
	/**
	 * Максимум длины base64 одной картинки в запросе к модели (символы).
	 * default - 400000
	 */
	attachmentImageMaxBase64: number;
}

// Примеры для кнопки в Security settings - не подставляются в deniedPaths автоматически
export const EXAMPLE_DENIED_PATHS: string[] = ['.env','.env.*','credentials.json','secrets.json','id_rsa','id_ed25519','id_ecdsa','.npmrc','.pypirc','.netrc','*.pem','*.key','*.p12','*.pfx','node_modules','.git',];

// Default sensitivePathPatterns: правки `.env*` -> ask/deny, отдельно от deniedPaths
export const DEFAULT_SENSITIVE_PATH_PATTERNS: string[] = ['.env', '.env.*'];

export const EXAMPLE_DENIED_COMMANDS: string[] = ['sudo', 'doas', 'su', 'rm', 'rmdir', 'unlink', 'dd', 'mkfs', 'fdisk', 'chmod', 'chown', 'chgrp', 'curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'sftp', 'docker', 'podman', 'kubectl', 'nerdctl', 'sh', 'bash', 'zsh', 'fish', 'dash', 'csh', 'tcsh', 'cmd', 'powershell', 'pwsh',];

export const EXAMPLE_SECRET_PATTERNS: string[] = [
	String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`,
	String.raw`\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]?[^\s'"]{8,}`,
	String.raw`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`,
	String.raw`\bBearer\s+[A-Za-z0-9\-._~+/]+=*`,
];

export const DEFAULT_SETTINGS: GenSettings = {
	baseUrl: '',
	model: '',
	smallModel: '',
	chatMode: 'ask',
	agentMaxIterations: 40,
	agentAuthLevel: 'ask',
	approvalPolicy: structuredClone(DEFAULT_APPROVAL_POLICY),
	autoApprove: false,
	continueLoopOnDeny: true,
	enableWorkspaceContext: true,
	alwaysOnWorkspaceContext: false,
	notifyOnComplete: false,
	enableFileReading: true,
	enableTerminal: true,
	webSearchEnabled: true,
	webFetchEnabled: true,
	systemPrompt: '',
	temperature: 0.2,
	maxTokens: 8192,
	maxContextTokens: 128_000,
	requestTimeoutMs: 120_000,
	maxInputChars: 8000,
	commentStyle: 'inline',
	previewBeforeApply: true,
	commentSystemPrompt: '',
	deniedPaths: [],
	sensitivePathPatterns: [...DEFAULT_SENSITIVE_PATH_PATTERNS],
	allowExternalDirectory: false,
	deniedCommands: [...EXAMPLE_DENIED_COMMANDS],
	secretPatterns: [],
	authHeader: 'Authorization',
	authScheme: 'Bearer',
	planWriteToFile: true,
	loggingEnabled: false,
	toolOutputMaxChars: 12_000,
	mcpServers: [],
	subagentDepth: 2,
	skillsPaths: [],
	skillsUrls: [],
	instructionUrls: [],
	personaId: '',
	formatAfterEdit: false,
	indexingEnabled: true,
	embeddingsBaseUrl: '',
	embeddingsModel: 'text-embedding-3-small',
	visionEnabled: false,
	attachmentImageMaxBase64: 400_000,
};
