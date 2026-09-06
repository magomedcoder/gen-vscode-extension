import { AsyncLocalStorage } from 'node:async_hooks';
import * as path from 'node:path';

/**
 * Корень агента для вложенных субагентов в git worktree.
 * Относительные пути tools резолвятся относительно этого каталога (если задан).
 */
const agentRootStore = new AsyncLocalStorage<string>();

// Текущий agent root (worktree cwd) или undefined = корень workspace
export function getAgentRoot(): string | undefined {
	return agentRootStore.getStore();
}

// Выполнить async-колбэк с переопределённым корнем путей
export async function withAgentRoot<T>(root: string, fn: () => Promise<T>): Promise<T> {
	return agentRootStore.run(path.resolve(root), fn);
}
