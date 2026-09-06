# Инструменты агента

[English version](tools.md)

Режим **Agent**. Пути только внутри workspace. Модели могут писать `/workspace/...` как портативный алиас корня первой папки workspace.

Учитываются `.gitignore` и `.genignore` в корне workspace (вместе с `deniedPaths` из настроек). Агент **не** обходит ignore «чтобы всё видеть». Подробнее: [security-ru.md](security-ru.md).

Подтверждение - **Settings -> Безопасность**: `approvalPolicy` (`allow` / `ask` / `review` / `deny`) и `autoApprove` (ask -> allow; deny остаётся). Capability-флаги могут полностью отключить terminal / file / web.

Подтверждения - **карточка в чате Gen** (Применить / Пропустить / Стоп или Применить / Отклонить). Панель чата фокусируется автоматически; отдельной вкладки нет.

| Tool                   | Действие                                                              | Подтверждать                                                                  |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `get_workspace_info`   | Папки workspace, имя, число документов                                | нет                                                                           |
| `get_active_editor`    | Активный редактор: путь, язык, курсор, выделение                      | нет                                                                           |
| `get_open_editors`     | Открытые вкладки                                                      | нет                                                                           |
| `list_dir`             | Список файлов/папок (без игнорируемых)                                | нет                                                                           |
| `read_file`            | Прочитать файл (опц. диапазон строк); PDF через `pdftotext`           | нет                                                                           |
| `search_files`         | Glob и/или поиск текста                                               | нет                                                                           |
| `codebase_search`      | Поиск по локальному индексу (триграммы, `.gen/index/`)                | нет                                                                           |
| `propose_plan`         | План шагов; сохраняется в сессии (sticky)                             | Спросить                                                                      |
| `update_plan`          | Статусы шагов / replace / clear активного плана                       | replace - Спросить; иначе нет                                                 |
| `write_file`           | Создать / полностью перезаписать                                      | Спросить: если файл уже есть; запрещён, если пользователь правил после агента |
| `apply_patch`          | Замена `old_string` -> `new_string`                                   | Спросить; также при правках пользователя поверх снимка агента                 |
| `apply_workspace_edit` | Несколько правок атомарно                                             | Спросить; также при правках пользователя на любом из файлов                   |
| `edit_notebook`        | Править / вставить ячейку Jupyter (`.ipynb`)                          | Спросить (confirmAlwaysOrSkip)                                                |
| `delete_file`          | Удалить файл (не папку)                                               | Спросить                                                                      |
| `create_dir`           | Создать каталог                                                       | нет                                                                           |
| `open_file`            | Открыть файл в редакторе                                              | нет                                                                           |
| `close_file`           | Закрыть вкладку (не грязную)                                          | нет                                                                           |
| `reveal_line`          | Перейти к строке                                                      | нет                                                                           |
| `git_status`           | `git status` + `diff --stat` (без commit/push)                        | нет                                                                           |
| `get_diagnostics`      | Ошибки TS/ESLint и т.п.                                               | нет                                                                           |
| `lsp`                  | definition / references / hover / symbols (line/character - 0-based)  | нет                                                                           |
| `find_logs`            | Найти `*.log` / `logs/` в workspace                                   | нет                                                                           |
| `read_log_tail`        | Хвост лог-файла (последние N строк)                                   | нет                                                                           |
| `open_browser`         | Открыть URL в Simple Browser VS Code                                  | Спросить                                                                      |
| `fetch_page`           | HTTP GET текста/HTML страницы (Design Mode)                           | Спросить; remote (не localhost) - всегда confirm                              |
| `web_search`           | Веб-поиск (`duckduckgo` \| `exa` \| `parallel` \| `http`)             | Спросить (confirmAlwaysOrSkip)                                                |
| `run_command`          | Команда в cwd workspace (allow + denylist)                            | Спросить                                                                      |
| `await_shell`          | Ждать фоновый job `run_command`; опционально regex `notify_on_output` | нет                                                                           |
| `run_tests`            | Тесты проекта (npm / go / cargo / pytest)                             | Спросить                                                                      |
| `list_plugins`         | Список локальных `.gen/tools` и `.gen/plugins` (без npm/JS)           | нет                                                                           |
| `plugin`               | Загрузить описание plugin/tool по имени в контекст                    | нет                                                                           |
| `list_mcp_tools`       | Список подключённых MCP-серверов и их tools                           | нет                                                                           |
| `call_mcp_tool`        | Вызвать один MCP tool (stdio)                                         | Спросить (confirmAlwaysOrSkip; action `mcp`)                                  |
| `execute`              | Experimental code-mode: JSON-шаги * только MCP (`codeModeEnabled`)    | Спросить на каждый шаг (как `call_mcp_tool`)                                  |

## Замечания

- Локальные plugins/tools: см. [architecture-ru.md](architecture-ru.md#локальные-plugins--tools-mvp). Каталог подмешивается в system prompt; JS не исполняется.
- Режимы чата **Debug** / **Design** включаются slash-командами `/debug` / `/design` (тот же agent loop со спец. system prompt). Debug: `find_logs` + `read_log_tail` + диагностики; Design: `open_browser` + `fetch_page` (без выполнения JS / кликов пока).
- Несколько файлов: сначала `propose_plan` -> файл `.gen/plan.md`; прогресс - `update_plan`. План переживает «Очистить» чат.
- Большой файл: короткая заготовка `write_file`, дальше `apply_patch` кусками.
- После успешного `write_file` / `apply_patch`, если у файла есть диагностики, в ответ tool добавляется короткая подсказка (tool не падает). Opt-in `formatAfterEdit` в настройках запускает `editor.action.formatDocument` после этих правок.
- Обзор проекта: `codebase_search` по фоновому индексу; точный grep - `search_files`.
- Если пользователь правил файл после агента: полный `write_file` отклоняется; правь через `apply_patch` / `apply_workspace_edit` по свежему `read_file`.
- `run_command` без shell/pipe. Запрещённые бинарники - из `deniedCommands`. Eval / git write / package install остаются в коде. Confirm через `approvalPolicy` / `autoApprove` (Безопасность).
- После хода агента можно **Восстановить снимок**.
- Секреты в результатах tools маскируются по regexp из настроек (если заданы).
- Опционально `primaryTools` (имена tools, по одному на строку): если непусто - primary-агенту отдаются только они (`list_mcp_tools` всегда доступен; пустой фильтр * откат ко всем). Субагенты список не применяют. Для code-mode явно добавьте `execute` в allowlist.
- Субагент `task`: опциональный git worktree через `worktreesEnabled` или аргумент `use_worktree`. Ветка в `.gen/worktrees/<slug>/` (fallback: sibling `*.gen-worktrees/`). Опционально `worktreeStartCommand` после create. Worktree не удаляется автоматически. Не git - пропуск, обычный субагент.
- Experimental **code-mode** (`codeModeEnabled`, по умолчанию выкл.): tool `execute` выполняет JSON-массив шагов `[{ "tool": "server__toolName", "arguments": { ... } }, ...]` (или тот же массив строкой `script`). Только объявленные MCP tools по имени - **без** host `eval` / Node / `require` / `fs`. Каждый шаг идёт через тот же путь подтверждения, что `call_mcp_tool`. Макс. 32 шага за вызов.
- В строках MCP `mcpServers` (`command`, `args`, значения `env`, `cwd`) подставляются `${env:NAME}` / `{env:NAME}` и `{file:path}` (относительно корня workspace).

Политика команд подробнее: [security-ru.md](security-ru.md#команды-run_command).
