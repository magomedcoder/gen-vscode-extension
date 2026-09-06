# Codebase index

[Русская версия](codebase-index-ru.md)

Local workspace index in `.gen/index/`.

The agent searches it via the `codebase_search` tool (trigrams), without sending the whole index to the LLM.

## Why

- Fast project overview without a full `search_files` scan
- Ranking code fragments for agent context

## How it works

- The index is written to `.gen/index/manifest.json`.
- `.gen/` is not indexed (same for `.git`, `node_modules` via ignore).
- On file change, only that file is reindexed (content-hash compare).
- `codebase_search` results are fragments (path, lines, snippet, score).
- In chat: `@file`, `@folder`, `@codebase` inject context through the Context Engine (see [chat.md](chat.md)).

## Usage

1. Open a workspace and open Gen chat.
2. Click **Create config & index** (writes `.gen/config.json`, scaffold dirs, and builds `.gen/index/`). Until then Gen does not create `.gen/` on folder open. The same scaffold runs on slash `/init`.
3. In Agent mode, call `codebase_search` with `query` (symbol, phrase, path).
4. For exact line grep - `search_files`.

### `.gen/` directories (scaffold)

On project enable or `/init`, these are created if missing: `agents/`, `commands/`, `plugins/`, `skills/`, `tools/`, `references/`, `plans/` - plus a short `.gen/README.md` and `.gitkeep` in empty dirs. Existing files are never overwritten. `references.json` is created on demand, not during scaffold.

More on tools: [tools.md](tools.md).
