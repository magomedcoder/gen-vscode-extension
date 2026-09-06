# Changelog

[English version](CHANGELOG.md)

## 0.3.0-dev (Версия в разработке)

- **Переполнение контекста:** разбор `exceed_context_size_error` (в т.ч. вложенный JSON llama.cpp); preflight оценка + shrink; auto-compact перед ходом; ограниченный retry; `contextOverflowPolicy` на экране Запросы; понятные ошибки вместо сырого HTTP 400
- Permissions v2: UI политики подтверждений (`allow` / `ask` / `review` / `deny`), Always + подсказка паттерна, session allowlist, auto-approve, continue-on-deny, capability toggles (legacy `agentAuthLevel` мигрирует в policy / autoApprove)
- Карточка подтверждения: кнопка **Always** + hint; allow/deny провайдеров по паттерну (`providerUsePolicy`)
- Admin policy: блокировка security-ключей через `GEN_ADMIN_POLICY` / `/etc/gen/policy.json` (баннер read-only в Settings)
- Slash-режимы: `/debug` `/design` `/plan` `/ask` `/agent`; также `/export` `/init` `/compact` `/new` `/undo` `/sessions` `/models`
- Режим **Plan**: правки только на чтение; shell ask или deny (`planShellPolicy`); handoff Plan↔Agent (banner + reminders)
- Multitask + `plan_enter` / `plan_exit` / `switch_mode`; артефакты WritePlan в `.gen/plans/`
- MCP stdio: отдельный экран настроек (enable/status/tools + JSON), `list_mcp_tools` / `call_mcp_tool`, cwd/timeout/headers на сервер
- MCP OAuth MVP: paste-token в SecretStorage, Auth / Logout / Debug (полный OIDC позже)
- Experimental code-mode: opt-in tool `execute` - JSON-шаги только как MCP-вызовы (без eval JS на хосте)
- Skills и rules: `AGENTS.md` / `.genrules`, discovery + tool `skill`, `/init`; экран Rules/Skills
- Personas: dropdown в Chat + экран Personas (`.gen/personas/`); экран Agents - clone builtin presets в `.gen/agents/`
- Локальные plugins/tools: discovery `.gen/tools` и `.gen/plugins` (каталог + `list_plugins` / `plugin`; без npm/JS runtime)
- Scaffold проекта: Enable / `/init` создаёт `.gen/{agents,commands,plugins,skills,tools,references,plans}`
- Слои конфига: user `~/.config/gen/config.json` + project `.gen/config.json`; JSON Schema + валидация VS Code
- Hooks: экран `.gen/hooks.json`; события `beforeSubmit` / `beforeShell` / `session.diff` / `session.compacting` / `shell.env` / `file.watcher`; импорт внешних hook-файлов
- Субагенты: `task` (`explore` / `general`), лимит вложенности, опциональные git worktrees + start command после create
- Tools: `glob`, `grep`, `file_search`, `web_search`, `todo_write` / `todo_read`, `ask_question`, `edit_notebook`, `lsp`, `semantic_search` / `search_docs`
- Web search: DuckDuckGo, Exa, Parallel или custom HTTP; model-routed patch (GPT оставляет `apply_patch`)
- Shell: сохранение cwd, background `run_command` + `await_shell` (`notify_on_output`), Stop на tool + countdown, cwd/exit/`line N` на карточках
- Упоминания: `@git` `@branch_diff` `@rules` `@link` `@code` `@Docs` `@agent` `@terminals` `@past` `@alias`/`@ref`; paste path `@file`; `!command`; Ctrl+L
- Chat UX: multi-session + fork, параллельные runs по табам, drafts, AskQuestion / Todo, thinking toggle, model picker, context ring, звук notify
- Review: pending-changes с деревом файлов + Accept/Reject на файл; CodeLens Keep/Undo; git-sync auto-Keep; edit + revertFiles
- Indexing: toggles + статус движка (CPU trigram / remote embeddings); opt-in OTEL spans для LLM
- Connection: пресеты llama.cpp (probe + list models)
- Settings UI: отдельные экраны (Чат / Агент / Индекс / Права); нав Основное / Дополнительно; все разделы всегда видны; блок пресетов локальных моделей убран; удобнее toggles полей
- Usage: ledger токенов по моделям (totals/sort); placeholder Quota (OAuth)
- Поиск по Settings; deep-links в VS Code; sidebar или bottom panel (`chatViewLocation`); light/HC polish
- LLM: учёт `Retry-After` при 429/5xx со статусом в composer; параллельные read-only tool batches; обрезка вывода tools
- Images/attachments: paste/drag + vision; `read_file` изображений; лимиты resize; export/import сессий; lossless archive после compact

## 0.2.0 (3 сентября 2026)

- Context Engine + упоминания `@file` / `@folder` / `@codebase` в чате (автодополнение в Composer)
- Документация: английские docs без суффикса `-ru`; русские - `*-ru.md` со ссылками EN/RU
- Настройка `deniedCommands`: denylist бинарников для `run_command` перенесён из кода в настройки
- Исправление **Без спроса** (`open`): без диалогов для команд, плана и overwrite правок пользователя
- Лимит итераций агента: `0` = без лимита
- Локализация: чат/настройки webview + UI host через `l10n/bundle.l10n*.json` (EN/RU; новый язык - новый bundle-файл)
- Opt-in проекта: не создавать `.gen/` при открытии папки; в чате Gen кнопка **Создать конфиг и индекс** (`.gen/config.json` + индекс)
- Composer context chips для `@file` / `@folder` / `@codebase` (выбор из автодополнения, снятие перед отправкой)
- Редактирование user-сообщения; история после него обрезается и turn переотправляется
- Accept / Reject по хункам в карточке tool-diff в чате
- Настройки: отключить запись `.gen/plan.md` (`planWriteToFile`); при перезапуске план загружается из файла, не из workspaceState
- Режимы чата **Debug** / **Design**: tools логов (`find_logs`, `read_log_tail`) и Simple Browser / `fetch_page`
- **`.genrules`** - опциональный файл правил проекта в system prompt agent / ask / комментариев
- Очередь turns при занятом агенте (**В очередь**; **Стоп** / **Очистить** сбрасывают очередь); итог токенов сессии в лог agent

## 0.1.0 (24 августа 2026)

- Чат и агент в bottom-панели (`ask` / `agent`)
  - streaming ответов (если сервер поддерживает)
  - кнопки `Стоп` и `Очистить`
  - очистка истории чата не перезаписывает сохранённый storage после отмены запроса
  - отображение расхода токенов (usage из API): в шапке чата и под сообщениями
- Агентный цикл и UX
  - LLM -> tool calls -> выполнение tools -> возврат результатов
  - карточки tool-call в чате (pending/ok/denied/error)
  - diff-preview для правок в режиме комментариев (и patch-first подход)
  - multi-file plan: `propose_plan` -> `.gen/plan.md` (sticky, переживает clear чата) + `update_plan` + карточка «Открыть» / ручной edit с diff для модели
  - локальный индекс кодовой базы (`.gen/index/`) + tool `codebase_search`
  - checkpoints: снапшот файлов до agent turn и предложение восстановления
  - своё подтверждение: карточка в чате Gen для agent, комментариев и checkpoint (без отдельной вкладки и без native MessageBox)
  - совместное редактирование: снимок после write/patch, запрет full `write_file` поверх user-diff, confirm при patch поверх правок пользователя
  - аудита в `Output` (`Gen Agent`): tool, путь/детали (с redaction), длительность, ok/error/denied
- Workspace tools (sandboxed)
  - `list_dir`, `read_file`, `search_files`, `write_file`, `apply_patch`, `delete_file`, `create_dir`
  - path sandbox: запрет выхода за workspace (`..`, symlink escape, пути вне workspace)
  - `.gitignore` / `.genignore` в корне workspace (пакет `ignore`, без `git check-ignore` на каждый tool)
  - подтверждение для опасных операций (write/patch/delete и т.п.)
  - git tools в read-only режиме (`git_status`), диагностика (`get_diagnostics`)
  - команды/терминал с allow/denylist политиками
- LLM-клиент
  - API key хранится в `SecretStorage` (settings -> API-ключ)
  - авторизация через `Authorization: Bearer` (или настраиваемые заголовок и схема)
  - retry для `429` и `5xx` с backoff (с сохранением ошибки/причин)
  - отмена запросов: отдельная обработка timeout vs abort
  - логи запросов в `Output` (`Gen LLM`) без body и без ключа
  - (опционально) запись логов на диск в фоне: `llm.log` / `agent.log` с очередью без блокировки запросов
- Настройки продукта (в основном окне редактора, не в webview-панели чата)
  - настройки разделены на страницы: «Основное», «Чат и агент», «Запросы», «Комментарии», «Безопасность», «Логи»
  - кнопка «Сбросить по умолчанию»
  - загрузка моделей по `baseUrl`
- Команды и локализация
  - категория `Gen` в палитре команд
  - сочетания по умолчанию: `Ctrl+Alt+G` - открыть чат; `Ctrl+Alt+/` - прокомментировать выделение
  - EN/RU: `package.nls` (манифест) и `vscode.l10n` (сообщения extension host)
- Пайплайн комментариев
  - команды: прокомментировать выделение; прокомментировать весь файл (контекстное меню редактора)
  - streaming генерации с прогрессом по символам (если сервер поддерживает)
  - few-shot примеры по семейству языка (JS/TS, Python, HTML, SQL, Lua, PHP и др.)
  - опциональный дополнительный system prompt в настройках «Комментарии»
  - извлечение кода из ответа модели (в т.ч. последний markdown-блок)
  - validate «не менять логику» + preview/diff перед apply
  - при провале validation - только «Применить всё равно», без обычного Apply
  - stale edit: проверка `document.version` и текста выделения перед apply
  - diff UX: подсветка языка virtual docs, модальное подтверждение, очистка virtual docs после закрытия diff
  - генерация комментариев с учётом языка файла и strip по языковым правилам
