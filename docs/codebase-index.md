# Codebase index

[Русская версия](codebase-index-ru.md)

Local workspace index in `.gen/index/`.

The agent searches it via the `codebase_search` tool (trigrams), without sending the whole index to the LLM.

## Why

- Fast project overview without a full `grep` / `glob` scan
- Ranking code fragments for agent context

## How it works

- The index is written to `.gen/index/manifest.json` (files, chunks, trigrams, **dirDigests** Merkle map).
- On update, ancestor directory digests are recomputed; unchanged dirs can skip re-read when path set + sizes match (MVP).
- LSP **symbol index** (optional cache): `.gen/index/symbols.json` via `vscode.executeDocumentSymbolProvider`. Used by `find_symbol` / `find_code` intent `symbol` and `@symbols`.
- **TS/JS outline** (no Tree-sitter): `.gen/index/outline.json` via TypeScript `createSourceFile` (classes / functions / imports). Other languages use a cheap regex fallback. Also exposed via `find_symbol` (`source: outline|all`).
- `.gen/` is not indexed (same for `.git`, `node_modules` via ignore).
- On file change, only that file is reindexed (content-hash compare).
- `codebase_search` results are fragments (path, lines, snippet, score).
- In chat: `@file`, `@folder`, `@codebase`, `@map`, `@symbols` inject context (see [chat.md](chat.md)).

### Local embeddings (`localEmbeddingsMode`)

| Mode                | Behavior                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `off`               | Remote `/embeddings` only                                                                                          |
| `trigram` (default) | Prefer remote; when remote is missing or fails, `semantic_search` / `find_code` fall back to IndexManager trigrams |

Call hierarchy / “who calls Y”: tool `find_references` (LSP reference + definition providers).

## Usage

1. Open a workspace and open Gen chat.
2. Click **Create config & index** (writes `.gen/config.json`, scaffold dirs, and builds `.gen/index/`). Until then Gen does not create `.gen/` on folder open. The same scaffold runs on slash `/init`.
3. In Agent mode, call `codebase_search` with `query` (symbol, phrase, path). Prefer `find_code` / `find_symbol` / `pack_context` / `similar_code` for hybrid retrieval.
4. For exact line grep - `grep` (paths via `glob`).

### `.gen/` directories (scaffold)

On project enable or `/init`, these are created if missing: `agents/`, `commands/`, `plugins/`, `skills/`, `tools/`, `references/`, `plans/` - plus a short `.gen/README.md` and `.gitkeep` in empty dirs. Existing files are never overwritten. `references.json` is created on demand, not during scaffold.

More on tools: [tools.md](tools.md).
