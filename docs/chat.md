# Chat and agent

[Русская версия](chat-ru.md)

Chat lives in the bottom **Gen** panel.

## Modes

| Mode       | How to enable     | Behavior                                                                          |
| ---------- | ----------------- | --------------------------------------------------------------------------------- |
| **Ask**    | button / `/ask`   | Text only. Selection in the active editor is added to context.                    |
| **Agent**  | button / `/agent` | Loop: LLM -> tool calls -> tool results -> LLM again (up to the iteration limit). |
| **Debug**  | `/debug`          | Like Agent, focused on logs and diagnostics (`find_logs`, `read_log_tail`).       |
| **Design** | `/design`         | Like Agent, focused on UI preview (`open_browser`, `fetch_page`).                 |

Type `/` in the input for slash-command autocomplete. You can attach a question: `/debug why is auth failing?`. Active Debug/Design shows as a badge next to Ask/Agent (click to return to Agent).

## Agent access level

Set in **Chat & Agent** settings:

| Level         | Code   | Behavior                                                     |
| ------------- | ------ | ------------------------------------------------------------ |
| **Read**      | `auto` | View and navigate only; write, delete, and shell are blocked |
| **Ask**       | `ask`  | Write/delete with modal confirmation (Apply / Skip / Stop)   |
| **No prompt** | `open` | No dialogs; actions are logged to Output `Gen Agent`         |

In **Ask**, writes, deletes, commands, and plan approval use the confirmation card. In **No prompt**, those dialogs are skipped.

## Chat UI

- **Stop** - cancels the current request / turn (also clears a pending confirmation).
- **Clear** - clears history (prevents an in-flight request from writing messages again).
- **Confirmation** - card above the input (agent and other actions: comments, checkpoint, undo). No separate tab.
- Tool-call cards: pending / ok / denied / error, mini-diff for edits.
- Token meter: total in the header; input/output under assistant replies (if the API returns usage).

## Multiple files

If a task touches **more than one file**:

1. The agent calls `propose_plan` (title + steps with path).
2. You approve the plan.
3. The plan is written to **`.gen/plan.md`** and shown as a card above the input; it is injected into following turns.
4. Further edits on plan paths skip repeated `propose_plan`; progress via `update_plan` or automatically by path.
5. You can edit `.gen/plan.md` by hand (“Open” on the card) - on the next turn the agent sees the diff and treats the file as canonical.
6. Reset the plan by deleting `.gen/plan.md` or `update_plan clear`. **Clear** chat history does **not** clear the plan.

A single file can be edited without a plan.

## Checkpoint

Before mutations the agent remembers file contents. After a turn you can **Restore snapshot** - roll back to the state before that turn’s edits.

## User edits

After a successful write the agent keeps a file snapshot. If you edit the buffer by hand, the next turn sees a user-diff in the system prompt; full `write_file` over such files is blocked - only a targeted patch (with confirm on conflict).

## Editor context and mentions

In Ask and Agent, the active file / selection may be included. The agent can also read files via tools.

In the input, type `@` and choose:

| Mention                         | What is injected                              |
| ------------------------------- | --------------------------------------------- |
| `@file path`                    | File contents                                 |
| `@folder path`                  | Files from a folder (capped)                  |
| `@codebase` / `@codebase query` | Fragments from the local index + open editors |
| `@git` / `@git SHA`             | Recent commits or `git show` for a SHA        |
| `@branch_diff`                  | `git status` + `diff --stat`                  |
| `@rules`                        | AGENTS.md / `.genrules`                       |
| `@link url`                     | Fetched page text (capped)                    |

Autocomplete: arrows / Tab / Enter.

More on the index: [codebase-index.md](codebase-index.md).

## Limits

- Paths must stay inside the workspace (see [security.md](security.md)).
- Large files: short `write_file` scaffold, then `apply_patch` in chunks (otherwise JSON tool-args may be cut by `max_tokens`).
- Agent iteration limit: 0 = unlimited; otherwise 1-40 (default 40).
