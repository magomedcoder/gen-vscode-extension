# Архитектура (для разработки)

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

## Сборка

- Extension host: esbuild -> `dist/extension.js`
- Webview: esbuild -> `dist/webview/`
- Тесты: `yarn test` (vscode-test)
- Локализация: `package.nls*.json`, `l10n/bundle.l10n*.json`
