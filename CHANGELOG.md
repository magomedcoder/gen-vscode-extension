# Changelog

[Русская версия](CHANGELOG-ru.md)

## 0.3.0-dev (Development version)

- Settings: dedicated **MCP** page (cards: enable/disable, status, tools list + JSON advanced); settings **search**
- Security: approval policy UI, auto-approve / continue-on-deny, capability toggles; Always confirm + `suggestPattern` session allowlist
- LLM: honor `Retry-After` on 429/5xx; show retry status in composer while busy
- Slash modes: `/debug` `/design` `/plan` `/ask` `/agent`; also `/export` `/init`
- **Plan** mode: read-only tool filter (no mutating edits/commands until you switch back)
- Permissions v2 foundation: `approvalPolicy` (allow / ask / review / deny), Always + suggested pattern, session allowlist, `autoApprove`, `continueLoopOnDeny`, capability toggles
- Confirm card: **Always** button + pattern hint
- Tools: `glob`, `grep`, `file_search`, `web_search`, `todo_write` / `todo_read`, `ask_question`, `skill`
- Project rules & skills: `AGENTS.md` / `.genrules`; skills discovery + `skill` tool; `/init` creates/updates `AGENTS.md`
- Agent loop: parallel read-only tool calls; tool output truncation (`toolOutputMaxChars`)
- Settings: `systemPrompt`, `smallModel`; usage ledger store
- Ctrl+L - add editor selection to chat
- MCP (stdio MVP): settings `mcpServers` (dedicated MCP page); tools `list_mcp_tools`, `call_mcp_tool`
- Subagents: tool `task` (`explore` read-only / `general`); nesting limit `subagentDepth`
- Shell: cwd persist across `run_command`; `background=true` + tool `await_shell`
- Mentions: `@git`, `@branch_diff`, `@rules`, `@link` (+ Composer autocomplete)
- Wave 3: `edit_notebook`, `lsp`, `semantic_search`/`search_docs`; `plan_enter`/`plan_exit`/`switch_mode` + multitask; `.gen/plans` + `.gen/agents`/`generate_agent`
- Wave 3: custom slash `.gen/commands`, `/compact` `/new` `/undo` `/sessions` `/models`; `!command`; hooks `.gen/hooks.json`
- Wave 3: multi-session + fork; MCP cwd/timeout; formatAfterEdit + diagnostics nudge; provider presets + remote embeddings
- Wave 4: Usage page; doom loop / external dir / `/redo`; `@code` `@Docs` `@agent` + image attachments; personas / scout / auto-title

## 0.2.0 (3 September 2026)

- Context Engine + `@file` / `@folder` / `@codebase` mentions in chat (Composer autocomplete)
- Docs: English docs without `-ru` suffix; Russian docs as `*-ru.md` with EN/RU cross-links
- Security setting `deniedCommands`: move `run_command` binary denylist from code into settings
- Fix **No prompt** (`open`): skip confirm dialogs for commands, plan, and overwrite of user edits
- Agent iteration limit: `0` means unlimited
- Localization: chat/settings webview + host UI strings via `l10n/bundle.l10n*.json` (EN/RU; add more locales by dropping in a new bundle)
- Opt-in project setup: do not create `.gen/` on folder open; Gen chat shows **Create config & index** (writes `.gen/config.json` + builds index)
- Composer context chips for `@file` / `@folder` / `@codebase` (pick from autocomplete, remove before send)
- Edit a user chat message; history after it is trimmed and the turn is resent
- Per-hunk Accept / Reject on agent file diffs in the chat tool card
- Settings: disable `.gen/plan.md` sync (`planWriteToFile`); on restart the plan loads from file, not workspaceState
- Chat modes **Debug** / **Design**: log tools (`find_logs`, `read_log_tail`) and Simple Browser / `fetch_page`
- **`.genrules`** - optional workspace rules file injected into agent, ask, and comment prompts
- Chat turn queue while busy (Composer **Queue**; **Stop** / **Clear** drop the queue); session token totals logged to agent Output

## 0.1.0 (24 August 2026)

- Chat and agent in the bottom panel (`ask` / `agent`)
  - streaming responses (when the server supports it)
  - `Stop` and `Clear` buttons
  - clearing chat history does not overwrite saved storage after a cancelled request
  - token usage display (API usage): in the chat header and under messages
- Agent loop and UX
  - LLM -> tool calls -> tool execution -> results returned
  - tool-call cards in chat (pending/ok/denied/error)
  - diff preview for edits in comment mode (and patch-first approach)
  - multi-file plan: `propose_plan` -> `.gen/plan.md` (sticky, survives chat clear) + `update_plan` + “Open” card / manual edit with diff for the model
  - local codebase index (`.gen/index/`) + `codebase_search` tool
  - checkpoints: file snapshot before an agent turn and restore offer
  - custom confirmation: card in the Gen chat for agent, comments, and checkpoints (no separate tab, no native MessageBox)
  - collaborative editing: snapshot after write/patch, block full `write_file` over user-diff, confirm when patching over user edits
  - audit in `Output` (`Gen Agent`): tool, path/details (with redaction), duration, ok/error/denied
- Workspace tools (sandboxed)
  - `list_dir`, `read_file`, `search_files`, `write_file`, `apply_patch`, `delete_file`, `create_dir`
  - path sandbox: block paths outside the workspace (`..`, symlink escape, paths outside workspace)
  - `.gitignore` / `.genignore` at workspace root (`ignore` package, no `git check-ignore` per tool call)
  - confirmation for dangerous operations (write/patch/delete, etc.)
  - read-only git tools (`git_status`), diagnostics (`get_diagnostics`)
  - commands/terminal with allow/denylist policies
- LLM client
  - API key stored in `SecretStorage` (Settings -> API key)
  - authorization via `Authorization: Bearer` (or configurable header and scheme)
  - retry for `429` and `5xx` with backoff (preserving error/cause)
  - request cancellation: separate handling for timeout vs abort
  - request logs in `Output` (`Gen LLM`) without body or key
  - (optional) background log files: `llm.log` / `agent.log` with a non-blocking queue
- Product settings (main editor window, not the chat webview panel)
  - settings split into pages: General, Chat & Agent, Requests, Comments, Security, Logs
  - “Reset to defaults” button
  - load models from `baseUrl`
- Commands and localization
  - `Gen` category in the command palette
  - default keybindings: `Ctrl+Alt+G` - open chat; `Ctrl+Alt+/` - comment selection
  - EN/RU: `package.nls` (manifest) and `vscode.l10n` (extension host messages)
- Comment pipeline
  - commands: comment selection; comment entire file (editor context menu)
  - streaming generation with character progress (when the server supports it)
  - few-shot examples by language family (JS/TS, Python, HTML, SQL, Lua, PHP, etc.)
  - optional extra system prompt in Comments settings
  - extract code from model response (including the last markdown block)
  - validate “do not change logic” + preview/diff before apply
  - on validation failure - “Apply anyway” only, no regular Apply
  - stale edit: check `document.version` and selection text before apply
  - diff UX: language highlighting in virtual docs, modal confirmation, clear virtual docs after closing diff
  - comment generation respects file language and strip rules per language
