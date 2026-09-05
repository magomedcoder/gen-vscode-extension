import type { Memento } from 'vscode';
import type { ChatUiMessage } from './protocol';

const SESSIONS_KEY = 'gen.chat.sessions';
const CURRENT_ID_KEY = 'gen.chat.currentSessionId';
// Старый ключ односессионного хранилища - мигрируем в multi-session
const LEGACY_MESSAGES_KEY = 'gen.chat.messages';

const MAX_SESSIONS = 40;
const MAX_STORED_MESSAGES = 80;

export interface StoredChatSession {
	id: string;
	title: string;
	messages: ChatUiMessage[];
	createdAt: number;
	updatedAt: number;
}

export interface SessionSummary {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
}

function newId(): string {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slimMessages(messages: ChatUiMessage[]): ChatUiMessage[] {
	return messages.slice(-MAX_STORED_MESSAGES).map((msg) => {
		if (!msg.toolCalls?.length) {
			return msg;
		}

		return {
			...msg,
			toolCalls: msg.toolCalls.map((call) => {
				if (!call.hunks?.length) {
					return call;
				}

				return {
					...call,
					hunks: call.hunks.map((hunk) => {
						if (hunk.status === 'pending') {
							return hunk;
						}

						const { 
							oldLines: _o, 
							newLines: _n, 
							beforeContext: _b, 
							afterContext: _a, 
							...rest 
						} = hunk;
						return {
							...rest,
							oldLines: [],
							newLines: [],
						};
					}),
				};
			}),
		};
	});
}

function toSummary(session: StoredChatSession): SessionSummary {
	return {
		id: session.id,
		title: session.title,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		messageCount: session.messages.length,
	};
}

// Заголовок новой сессии («Новый чат»)
export const DEFAULT_SESSION_TITLE = 'Новый чат';

export function isDefaultSessionTitle(title: string | undefined): boolean {
	return !title?.trim() || title.trim() === DEFAULT_SESSION_TITLE;
}

function defaultTitle(): string {
	return DEFAULT_SESSION_TITLE;
}

// Persist нескольких чат-сессий в workspaceState (или переданный Memento).
export class SessionStore {
	private sessions: StoredChatSession[] = [];
	private currentId = '';

	constructor(private readonly memento: Memento) {
		this.load();
	}

	private load(): void {
		const raw = this.memento.get<StoredChatSession[]>(SESSIONS_KEY);
		const current = this.memento.get<string>(CURRENT_ID_KEY, '');

		if (Array.isArray(raw) && raw.length > 0) {
			this.sessions = raw.filter((s) => s && typeof s === 'object' && typeof s.id === 'string')
				.map((s) => ({
					id: s.id,
					title: String(s.title || defaultTitle()).slice(0, 120),
					messages: Array.isArray(s.messages) ? s.messages : [],
					createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
					updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
				}));
			this.currentId = this.sessions.some((s) => s.id === current) ? current : this.sessions[0]!.id;
			return;
		}

		// Миграция со старого односессионного ключа
		const legacy = this.memento.get<ChatUiMessage[]>(LEGACY_MESSAGES_KEY, []);
		const now = Date.now();
		const migrated: StoredChatSession = {
			id: newId(),
			title: legacy.length > 0 ? titleFromMessages(legacy) : defaultTitle(),
			messages: Array.isArray(legacy) ? legacy : [],
			createdAt: now,
			updatedAt: now,
		};
		this.sessions = [migrated];
		this.currentId = migrated.id;
		void this.persistAll();
		if (legacy.length > 0) {
			void this.memento.update(LEGACY_MESSAGES_KEY, undefined);
		}
	}

	private persistAll(): Thenable<void> {
		const trimmed = this.sessions.slice()
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, MAX_SESSIONS)
			.map((s) => ({
				...s,
				messages: slimMessages(s.messages),
			}));
		this.sessions = trimmed;
		if (!this.sessions.some((s) => s.id === this.currentId) && this.sessions[0]) {
			this.currentId = this.sessions[0].id;
		}

		return this.memento.update(SESSIONS_KEY, this.sessions).then(() =>
			this.memento.update(CURRENT_ID_KEY, this.currentId),
		);
	}

	listSessions(): SessionSummary[] {
		return this.sessions.slice()
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map(toSummary);
	}

	getCurrentSessionId(): string {
		return this.currentId;
	}

	getSession(id: string): StoredChatSession | undefined {
		return this.sessions.find((s) => s.id === id);
	}

	getCurrent(): StoredChatSession {
		const cur = this.getSession(this.currentId);
		if (cur) {
			return cur;
		}

		const created = this.createSession();
		return created;
	}

	// Сохранить сообщения текущей (или указанной) сессии
	saveMessages(messages: ChatUiMessage[], sessionId?: string): void {
		const id = sessionId ?? this.currentId;
		const idx = this.sessions.findIndex((s) => s.id === id);
		if (idx < 0) {
			return;
		}

		const prev = this.sessions[idx]!;
		// Title «Новый чат» оставляем - LLM-title (systemAgents) или renameSession обновят после хода
		this.sessions[idx] = {
			...prev,
			messages: slimMessages(messages),
			updatedAt: Date.now(),
		};
		void this.persistAll();
	}

	createSession(title?: string): StoredChatSession {
		const now = Date.now();
		const session: StoredChatSession = {
			id: newId(),
			title: (title?.trim() || defaultTitle()).slice(0, 120),
			messages: [],
			createdAt: now,
			updatedAt: now,
		};
		this.sessions.unshift(session);
		this.currentId = session.id;
		void this.persistAll();
		return session;
	}

	switchSession(id: string): StoredChatSession | undefined {
		const session = this.getSession(id);
		if (!session) {
			return undefined;
		}

		this.currentId = id;
		void this.memento.update(CURRENT_ID_KEY, this.currentId);
		return session;
	}

	renameSession(id: string, title: string): boolean {
		const trimmed = title.trim().slice(0, 120);
		if (!trimmed) {
			return false;
		}

		const idx = this.sessions.findIndex((s) => s.id === id);
		if (idx < 0) {
			return false;
		}

		this.sessions[idx] = {
			...this.sessions[idx]!,
			title: trimmed,
			updatedAt: Date.now(),
		};
		void this.persistAll();
		return true;
	}

	deleteSession(id: string): boolean {
		if (this.sessions.length <= 1) {
			// Последнюю сессию не удаляем - очищаем сообщения
			const only = this.sessions[0];
			if (!only || only.id !== id) {
				return false;
			}

			this.sessions[0] = {
				...only,
				title: defaultTitle(),
				messages: [],
				updatedAt: Date.now(),
			};
			this.currentId = only.id;
			void this.persistAll();
			return true;
		}

		const next = this.sessions.filter((s) => s.id !== id);
		if (next.length === this.sessions.length) {
			return false;
		}

		this.sessions = next;
		if (this.currentId === id) {
			this.currentId = this.sessions[0]!.id;
		}
		void this.persistAll();
		return true;
	}

	// Новая сессия с копией сообщений до messageId включительно.
	forkFromMessage(sourceId: string, messageId: string, title?: string): StoredChatSession | undefined {
		const source = this.getSession(sourceId);
		if (!source) {
			return undefined;
		}

		const idx = source.messages.findIndex((m) => m.id === messageId);
		if (idx < 0) {
			return undefined;
		}

		const copied = source.messages.slice(0, idx + 1).map((m) => structuredClone(m));
		const now = Date.now();
		const session: StoredChatSession = {
			id: newId(),
			title: (title?.trim() || `Fork: ${source.title}`).slice(0, 120),
			messages: slimMessages(copied),
			createdAt: now,
			updatedAt: now,
		};
		this.sessions.unshift(session);
		this.currentId = session.id;
		void this.persistAll();
		return session;
	}
}

function titleFromMessages(messages: ChatUiMessage[]): string {
	const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
	if (!firstUser) {
		return DEFAULT_SESSION_TITLE;
	}

	const line = firstUser.content.trim().split(/\r?\n/)[0] ?? '';
	const cleaned = line.replace(/^\/\w+\s*/, '').trim();
	if (!cleaned) {
		return DEFAULT_SESSION_TITLE;
	}

	return cleaned.length > 48 ? `${cleaned.slice(0, 45)}...` : cleaned;
}

// Fallback-title из первого user-сообщения (если smallModel недоступен)
export function fallbackTitleFromMessages(messages: ChatUiMessage[]): string {
	return titleFromMessages(messages);
}
