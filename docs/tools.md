# Agent tools

[Русская версия](tools-ru.md)

**Agent** mode. Paths must stay inside the workspace. Models may use `/workspace/...` as a portable alias for the first workspace folder root.

`.gitignore` and `.genignore` at the workspace root are respected (together with `deniedPaths` from settings). The agent does **not** bypass ignore “to see everything”. Details: [security.md](security.md).

Confirmation follows **Settings -> Security**: `approvalPolicy` (`allow` / `ask` / `review` / `deny`) and `autoApprove` (asks -> allow; denies stay). Capability toggles can disable terminal / file / web entirely.

Confirmations are a **card in Gen chat** (Apply / Skip / Stop or Apply / Reject). The chat panel is focused automatically; there is no separate tab.

| Tool                   | Action                                                                   | Confirm                                                             |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `get_workspace_info`   | Workspace folders, name, document count                                  | no                                                                  |
| `get_active_editor`    | Active editor: path, language, cursor, selection                         | no                                                                  |
| `get_open_editors`     | Open tabs                                                                | no                                                                  |
| `list_dir`             | List files/folders (excluding ignored)                                   | no                                                                  |
| `read_file`            | Read a file (optional line range); PDF via `pdftotext`                   | no                                                                  |
| `search_files`         | Glob and/or text search                                                  | no                                                                  |
| `codebase_search`      | Search the local index (trigrams, `.gen/index/`)                         | no                                                                  |
| `propose_plan`         | Step plan; kept in session (sticky)                                      | Ask                                                                 |
| `update_plan`          | Step statuses / replace / clear active plan                              | replace - Ask; otherwise no                                         |
| `write_file`           | Create / fully overwrite                                                 | Ask: if the file exists; blocked if the user edited after the agent |
| `apply_patch`          | Replace `old_string` -> `new_string`                                     | Ask; also Ask when patching over user edits on the agent snapshot   |
| `apply_workspace_edit` | Several edits atomically                                                 | Ask; also Ask when user edits exist on any of the files             |
| `edit_notebook`        | Edit / insert Jupyter cell (`.ipynb`)                                    | Ask (confirmAlwaysOrSkip)                                           |
| `delete_file`          | Delete a file (not a folder)                                             | Ask                                                                 |
| `create_dir`           | Create a directory                                                       | no                                                                  |
| `open_file`            | Open a file in the editor                                                | no                                                                  |
| `close_file`           | Close a tab (not dirty)                                                  | no                                                                  |
| `reveal_line`          | Jump to a line                                                           | no                                                                  |
| `git_status`           | `git status` + `diff --stat` (no commit/push)                            | no                                                                  |
| `get_diagnostics`      | TS/ESLint errors, etc.                                                   | no                                                                  |
| `lsp`                  | definition / references / hover / symbols (0-based line/character)       | no                                                                  |
| `find_logs`            | Find `*.log` / `logs/` in the workspace                                  | no                                                                  |
| `read_log_tail`        | Last N lines of a log file                                               | no                                                                  |
| `open_browser`         | Open URL in VS Code Simple Browser                                       | Ask                                                                 |
| `fetch_page`           | HTTP GET page text/HTML (Design Mode)                                    | Ask; remote (non-localhost) always confirms                         |
| `web_search`           | Web search (`duckduckgo` \| `exa` \| `parallel` \| `http`)               | Ask (confirmAlwaysOrSkip)                                           |
| `run_command`          | Command in workspace cwd (allow + denylist)                              | Ask                                                                 |
| `await_shell`          | Wait for background `run_command` job; optional `notify_on_output` regex | no                                                                  |
| `run_tests`            | Project tests (npm / go / cargo / pytest)                                | Ask                                                                 |
| `list_plugins`         | List local `.gen/tools` and `.gen/plugins` (no npm/JS)                   | no                                                                  |
| `plugin`               | Load a local plugin/tool description by name into context                | no                                                                  |
| `list_mcp_tools`       | List connected MCP servers and their tools                               | no                                                                  |
| `call_mcp_tool`        | Call one MCP tool (stdio)                                                | Ask (confirmAlwaysOrSkip; action `mcp`)                             |
| `execute`              | Experimental code-mode: JSON steps * MCP tools only (`codeModeEnabled`)  | Ask per step (same as `call_mcp_tool`)                              |

## Notes

- Local plugins/tools: see [architecture.md](architecture.md#local-plugins--tools-mvp). Catalog is injected into the system prompt; JS is not executed.
- Chat modes **Debug** / **Design** are enabled via slash commands `/debug` / `/design` (same agent loop with a focused system prompt). Debug prefers `find_logs` + `read_log_tail` + diagnostics; Design uses `open_browser` + `fetch_page` (no JS execution / no clicks yet).
- Multiple files: start with `propose_plan` -> `.gen/plan.md`; progress via `update_plan`. The plan survives **Clear** chat.
- Large file: short `write_file` scaffold, then `apply_patch` in chunks.
- After successful `write_file` / `apply_patch`, if the file has diagnostics, the tool result appends a short nudge (tool still succeeds). Opt-in `formatAfterEdit` in settings runs `editor.action.formatDocument` after those edits.
- Optional setting `primaryTools` (tool names, one per line): when non-empty, only those tools are offered to the primary agent (`list_mcp_tools` stays available; empty filter falls back to all). Subagents ignore this list. Include `execute` explicitly if you use a primary allowlist with code-mode.
- Subagent tool `task`: optional git worktree via setting `worktreesEnabled` or arg `use_worktree`. Creates branch under `.gen/worktrees/<slug>/` (fallback: sibling `*.gen-worktrees/`). Optional `worktreeStartCommand` runs once after create. Worktrees are not auto-deleted. Non-git workspace * skipped, normal subagent.
- Experimental **code-mode** (`codeModeEnabled`, default off): tool `execute` runs a JSON array of steps `[{ "tool": "server__toolName", "arguments": { ... } }, ...]` (or the same array as a `script` JSON string). Only declared MCP tools by name - **no** host `eval` / Node / `require` / `fs`. Each step reuses the `call_mcp_tool` approval path. Max 32 steps per call.
- Project overview: `codebase_search` on the background index; exact grep - `search_files`.
- If the user edited a file after the agent: full `write_file` is rejected; patch via `apply_patch` / `apply_workspace_edit` after a fresh `read_file`.
- `run_command` without shell/pipe. Blocked binaries come from `deniedCommands`. Eval / git write / package install stay blocked in code. Confirm via `approvalPolicy` / `autoApprove` (Security settings).
- After an agent turn you can **Restore snapshot**.
- Secrets in tool results are masked by regexps from settings (if set).
- MCP `mcpServers` strings (`command`, `args`, `env` / `headers` values, `cwd`) interpolate `${env:NAME}` / `{env:NAME}` and `{file:path}` (relative to the workspace folder). Optional `headers` become `GEN_MCP_HEADER_*` env vars for stdio (future HTTP transport will send them as HTTP headers).

Command policy details: [security.md](security.md#commands-run_command).
