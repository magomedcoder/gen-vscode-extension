# Архитектура (для разработки)

[English version](architecture.md)

## Потоки данных

```
Chat (webview)
  -> ChatViewProvider / ChatSession
      -> Ask: HttpLlmClient.complete
      -> Agent: AgentSession.run -> tools -> resolveWorkspacePath -> policy + gitIgnore

Comment command
  -> runCommentPipeline
      -> buildCommentMessages -> LLM -> extract -> validate -> showCommentDiff -> apply
```

## Политика путей

1. `resolveAgainstFolders` / symlink check  
2. `deniedPaths` (`policy.ts`)  
3. `.gitignore` + `.genignore` (`gitIgnore.ts`, кэш на turn)

## Совместное редактирование

- После успешного `write_file` / `apply_patch` / `apply_workspace_edit` сессия хранит снимок «как агент оставил» (`AgentWriteTracker`).
- Если буфер расходится со снимком: полный `write_file` запрещён; `apply_patch` / `apply_workspace_edit` - поверх актуального текста + confirm при конфликте.
- В system prompt на ход подмешивается краткий user-diff по затронутым файлам.

## Sticky plan

- После approve `propose_plan` план пишется в **`.gen/plan.md`** (+ кэш `workspaceState`).
- «Очистить» чат **не** сбрасывает план; сброс - `update_plan clear` / удаление `.gen/plan.md`.
- Перед agent turn файл перечитывается; ручной diff -> system prompt; карточка «Открыть» / watcher для UI.

## Индекс кодовой базы

- Фоновая индексация в `.gen/index/manifest.json` (`src/index/`).
- Инкремент по hash файла; `.gen/` не индексируется.
- Tool `codebase_search` - триграммный поиск по chunks.
- Context Engine (`contextEngine.ts`): ранжирует hits индекса и открытых редакторов; используется в `@codebase` и при сборке контекста упоминаний.
- Подробнее: [codebase-index-ru.md](codebase-index-ru.md), упоминания - [chat-ru.md](chat-ru.md).

## Сборка

- Extension host: esbuild -> `dist/extension.js`
- Webview: esbuild -> `dist/webview/`
- Тесты: `yarn test` (vscode-test)
- Локализация: `package.nls*.json` (команды/манифест), `l10n/bundle.l10n*.json` (host + UI webview). Строки webview инжектятся как `window.__GEN_L10N__` по локали host.
