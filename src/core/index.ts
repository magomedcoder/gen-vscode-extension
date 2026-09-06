/**
 * Core host services (config / llm / stores / log).
 *
 * New code may import from `../core/config/...` etc.
 * Legacy `src/config`, `src/llm`, `src/stores`, `src/log` are thin shims.
 */
export { initSettings, getSettings } from './config/settings';
export type { GenSettings } from './config/settings';
export { HttpLlmClient } from './llm/client';
export { initLogger } from './log/logger';
export { initUsageStore } from './stores/usageStore';
export { initActivityStore } from './stores/activityStore';
