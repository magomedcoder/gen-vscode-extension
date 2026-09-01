# Architecture (for development)

[Русская версия](architecture-ru.md)

## Data flows

```
Chat (webview)
  -> ChatViewProvider / ChatSession
      -> Ask: HttpLlmClient.complete
      -> Agent: AgentSession.run -> tools -> resolveWorkspacePath -> policy + gitIgnore

Comment command
  -> runCommentPipeline
      -> buildCommentMessages -> LLM -> extract -> validate -> showCommentDiff -> apply
```

## Path policy

1. `resolveAgainstFolders` / symlink check  
2. `deniedPaths` (`policy.ts`)  
3. `.gitignore` + `.genignore` (`gitIgnore.ts`, cached per turn)

## Collaborative editing

- After a successful `write_file` / `apply_patch` / `apply_workspace_edit`, the session keeps a snapshot of “how the agent left it” (`AgentWriteTracker`).
- If the buffer diverges from the snapshot: full `write_file` is blocked; `apply_patch` / `apply_workspace_edit` apply on current text + confirm on conflict.
- A short user-diff for touched files is injected into the system prompt each turn.

## Sticky plan

- After approving `propose_plan`, the plan is written to **`.gen/plan.md`** when `planWriteToFile` is enabled; in-memory cache for the current session only.
- On extension / workspace restart the plan loads from **`.gen/plan.md`**, not persisted storage.
- **Clear** chat does **not** reset the plan; reset via `update_plan clear` / delete `.gen/plan.md`.
- Before an agent turn the file is re-read; manual diff -> system prompt; file watcher for external edits.

## Project rules (`.genrules`)

- Optional markdown/text file in the workspace root: coding style, architecture, team conventions.
- Loaded at extension start and on file change; injected into agent, ask, and comment prompts (truncated at 12k chars).

## Codebase index

- Background indexing into `.gen/index/manifest.json` (`src/index/`).
- Incremental by file hash; `.gen/` is not indexed.
- Tool `codebase_search` - trigram search over chunks.
- Context Engine (`contextEngine.ts`): ranks index hits and open editors; used by `@codebase` and mention context packing.
- Details: [codebase-index.md](codebase-index.md), mentions - [chat.md](chat.md).

## Build

- Extension host: esbuild -> `dist/extension.js`
- Webview: esbuild -> `dist/webview/`
- Tests: `yarn test` (vscode-test)
- Localization: `package.nls*.json` (commands/manifest), `l10n/bundle.l10n*.json` (host + webview UI). Webview strings are injected as `window.__GEN_L10N__` from the host locale.
