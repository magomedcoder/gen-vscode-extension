# Индекс кодовой базы

[English version](codebase-index.md)

Локальный индекс workspace в `.gen/index/`. 

Агент ищет по нему через tool `codebase_search` (триграммы), без отправки всего индекса в LLM.

## Зачем

- Быстрый обзор проекта без полного `search_files`
- Ранжирование фрагментов кода для контекста агента

## Как устроено

- Индекс пишется в `.gen/index/manifest.json`.
- `.gen/` не индексируется (как и `.git`, `node_modules` через ignore).
- При изменении файла переиндексируется только он (сравнение content-hash).
- Результаты `codebase_search` - фрагменты (path, строки, snippet, score).
- В чате: `@file`, `@folder`, `@codebase` подмешивают контекст через Context Engine (см. [chat-ru.md](chat-ru.md)).

## Использование

1. Открыть workspace - индекс строится в фоне.
2. В режиме Agent вызвать `codebase_search` с `query` (символ, фраза, путь).
3. Для точного grep по строке - `search_files`.

Подробнее про tools: [tools-ru.md](tools-ru.md).
