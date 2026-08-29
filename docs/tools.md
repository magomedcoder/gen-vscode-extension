# Agent tools

[Русская версия](tools-ru.md)

**Agent** mode. Paths must stay inside the workspace.

`.gitignore` and `.genignore` at the workspace root are respected (together with `deniedPaths` from settings). The agent does **not** bypass ignore “to see everything”. Details: [security.md](security.md).

Confirmation depends on access level: **Read** (edits and commands blocked), **Ask** (confirm writes/deletes/commands/plan), **No prompt** (no dialogs; actions go to Output `Gen Agent`).

Confirmations are a **card in Gen chat** (Apply / Skip / Stop or Apply / Reject). The chat panel is focused automatically; there is no separate tab.

| Tool                   | Action                                           | Confirm                                                             |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| `get_workspace_info`   | Workspace folders, name, document count          | no                                                                  |
| `get_active_editor`    | Active editor: path, language, cursor, selection | no                                                                  |
| `get_open_editors`     | Open tabs                                        | no                                                                  |
| `list_dir`             | List files/folders (excluding ignored)           | no                                                                  |
| `read_file`            | Read a file (optional line range)                | no                                                                  |
| `search_files`         | Glob and/or text search                          | no                                                                  |
| `codebase_search`      | Search the local index (trigrams, `.gen/index/`) | no                                                                  |
| `propose_plan`         | Step plan; kept in session (sticky)              | Ask                                                                 |
| `update_plan`          | Step statuses / replace / clear active plan      | replace - Ask; otherwise no                                         |
| `write_file`           | Create / fully overwrite                         | Ask: if the file exists; blocked if the user edited after the agent |
| `apply_patch`          | Replace `old_string` -> `new_string`             | Ask; also Ask when patching over user edits on the agent snapshot   |
| `apply_workspace_edit` | Several edits atomically                         | Ask; also Ask when user edits exist on any of the files             |
| `delete_file`          | Delete a file (not a folder)                     | Ask                                                                 |
| `create_dir`           | Create a directory                               | no                                                                  |
| `open_file`            | Open a file in the editor                        | no                                                                  |
| `close_file`           | Close a tab (not dirty)                          | no                                                                  |
| `reveal_line`          | Jump to a line                                   | no                                                                  |
| `git_status`           | `git status` + `diff --stat` (no commit/push)    | no                                                                  |
| `get_diagnostics`      | TS/ESLint errors, etc.                           | no                                                                  |
| `find_logs`            | Find `*.log` / `logs/` in the workspace          | no                                                                  |
| `read_log_tail`        | Last N lines of a log file                       | no                                                                  |
| `open_browser`         | Open URL in VS Code Simple Browser               | Ask                                                                 |
| `fetch_page`           | HTTP GET page text/HTML (Design Mode)            | Ask; remote (non-localhost) always confirms                         |
| `run_command`          | Command in workspace cwd (allow + denylist)      | Ask                                                                 |
| `run_tests`            | Project tests (npm / go / cargo / pytest)        | Ask                                                                 |

## Notes

- Chat modes **Debug** / **Design** use the same agent loop with a focused system prompt. Debug prefers `find_logs` + `read_log_tail` + diagnostics; Design uses `open_browser` + `fetch_page` (no JS execution / no clicks yet).
- Multiple files: start with `propose_plan` -> `.gen/plan.md`; progress via `update_plan`. The plan survives **Clear** chat.
- Large file: short `write_file` scaffold, then `apply_patch` in chunks.
- Project overview: `codebase_search` on the background index; exact grep - `search_files`.
- If the user edited a file after the agent: full `write_file` is rejected; patch via `apply_patch` / `apply_workspace_edit` after a fresh `read_file`.
- `run_command` without shell/pipe. Blocked binaries come from `deniedCommands`. Eval / git write / package install stay blocked in code. Confirm in **Ask**; skipped in **No prompt**.
- After an agent turn you can **Restore snapshot**.
- Secrets in tool results are masked by regexps from settings (if set).

Command policy details: [security.md](security.md#commands-run_command).
