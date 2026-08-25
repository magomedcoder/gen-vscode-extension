# Settings

[Русская версия](settings-ru.md)

**Reset to defaults** restores all fields to defaults; the **API key is not cleared**.

## General

| Field      | Default         | Description                                                                                    |
| ---------- | --------------- | ---------------------------------------------------------------------------------------------- |
| Base URL   | empty           | API root: primarily **llama.cpp** (`http://127.0.0.1:8080`), or any OpenAI-compatible endpoint |
| API key    | -               | In `SecretStorage`; empty - do not send a header                                               |
| Key header | `Authorization` | HTTP header name                                                                               |
| Key scheme | `Bearer`        | Value prefix; empty scheme - raw key                                                           |
| Model      | empty           | Model id; list is loaded from the URL                                                          |

## Chat & Agent

| Field           | Default | Description            |
| --------------- | ------- | ---------------------- |
| Chat mode       | `ask`   | Ask or Agent           |
| Iteration limit | `40`    | 1-40                   |
| Access level    | `ask`   | Read / Ask / No prompt |

## Requests

| Field                | Default  | Description                       |
| -------------------- | -------- | --------------------------------- |
| Temperature          | `0.2`    | 0-2; keep low for stable format   |
| Max response tokens  | `8192`   | min 64                            |
| Timeout (ms)         | `120000` | min 1000                          |
| Max input characters | `8000`   | Limit for comment fragments, etc. |

## Comments

| Field               | Default  | Description                           |
| ------------------- | -------- | ------------------------------------- |
| Style               | `inline` | `inline` or `block`                   |
| Diff before apply   | on       | Show diff and modal confirmation      |
| Extra system prompt | empty    | Appended to the standard instructions |

Details: [comments.md](comments.md).

## Security

| Field           | Default | Description                         |
| --------------- | ------- | ----------------------------------- |
| Denied paths    | empty   | Globs, one per line (`deniedPaths`) |
| Secret patterns | empty   | JS regexps; matches -> `[REDACTED]` |

There are “Insert examples” buttons. Full path policy: [security.md](security.md).

## Logs

| Field      | Default | Description                                    |
| ---------- | ------- | ---------------------------------------------- |
| Write logs | off     | Output `Gen LLM` / `Gen Agent` + files on disk |

**Open logs folder** button. Details: [logging.md](logging.md).
