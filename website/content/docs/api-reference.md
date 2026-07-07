---
title: API reference
description: Coop AI API v1 — chat, inline completion, health, and authentication.
section: api
order: 1
lastUpdated: "2026-07-06"
---

All routes are served from your API base URL (`https://api.coop-ai.dev` or self-hosted).

## Authentication

### Extension and admin portal

Users sign in with **email + password**, **Google**, or **SSO (SAML)**. The extension stores a session token after sign-in — not a pasted API key.

### Automation and API access

For scripts, CI, and direct HTTP calls to the API:

```http
Authorization: Bearer <org-api-key>
```

Org API keys (`coop_…`) are created in the admin portal **API Keys** page. They are optional for developers using the VS Code extension.

When `COOP_REQUIRE_API_AUTH=true` (production default), `/v1/chat` and `/v1/completions/inline` accept either a valid user session (extension) or a Bearer org API key (automation).

## Health

### `GET /health`

Returns server status, cache, webhooks, jobs, and configured LLM providers.

```json
{
  "ok": true,
  "cache": { "backend": "memory", "repos": 2 },
  "webhooks": [],
  "jobs": {},
  "llm": {
    "mockMode": false,
    "configuredProviders": ["anthropic", "openai"]
  }
}
```

The extension calls this automatically when you are signed in.

## Chat

### `POST /v1/chat`

Streams assistant output as Server-Sent Events (SSE).

**Request body:**

```json
{
  "message": "Why was this handler written this way?",
  "history": [],
  "context": {
    "owner": "acme",
    "repo": "api",
    "branch": "main",
    "file": "src/handler.ts",
    "selectedLines": [10, 42]
  },
  "useCase": "decision_archaeology",
  "stream": true
}
```

**`useCase` values:** `comprehension` | `decision_archaeology` | `ownership` | `blast_radius` | `knowledge_gaps` | `chat` | `inline_completion`

**SSE events:**

| type | Fields |
| --- | --- |
| `delta` | `text` |
| `done` | `usage`, `model`, `provider`, `finishReason` |
| `error` | `message`, `code?` |

**Errors:** `401` unauthorized, `429` rate limited, `502` provider failure

## Inline completion

### `POST /v1/completions/inline`

Streaming or batch completion for editor ghost text (`useCase: inline_completion`). Same auth as `/v1/chat`.

The VS Code extension sends `x-use-case: code-completion-only` for zero-retention routing.

**Request body:**

| Field | Type | Notes |
| --- | --- | --- |
| `message` | string? | Prompt with surrounding code (chat-fallback when FIM unavailable) |
| `segments` | object? | FIM mode: `{ prefix, suffix }` — requires non-empty `prefix` if `message` omitted |
| `segments.prefix` | string | Code before cursor (max 4,000 chars) |
| `segments.suffix` | string? | Code after cursor (max 2,000 chars) |
| `stream` | boolean? | `true` → SSE (`text/event-stream`); default `false` → JSON |
| `repoId` | string? | Repo id for quota, audit, and graph context |
| `useGraphContext` | boolean? | Attach indexed graph slice (**Pro** / Enterprise) |
| `languageId` | string? | VS Code language id |
| `file` | string? | File path (metadata) |
| `provider` | string? | `anthropic` \| `openai` \| `deepseek` \| `gemini` \| `mistral` |
| `model` | string? | Fast model (e.g. `claude-haiku-4-5-20251001`, `codestral-latest`) |
| `maxTokens` | number? | Default 96; cap **200** (multi-line completions use higher limit) |
| `temperature` | number? | Default 0.15 |

**Validation:** require `message` **or** non-empty `segments.prefix`.

**FIM routing (server-side):** when `segments.prefix` is present, the API prefers:

1. Mistral Codestral FIM (`MISTRAL_API_KEY`) → `codestral-latest`
2. DeepSeek FIM (`DEEPSEEK_API_KEY`) → `deepseek-chat`
3. Chat fallback via `message` (Anthropic Haiku or OpenAI mini)

Response includes `"fim": true` when a FIM provider handled the request.

**Response** `200` (JSON, `stream` omitted or `false`):

```json
{
  "text": "completion text only",
  "alternatives": [],
  "model": "codestral-latest",
  "provider": "mistral",
  "latencyMs": 120,
  "fim": true,
  "usage": {
    "inputTokens": 42,
    "outputTokens": 8
  }
}
```

**Response** `200` (`stream: true`):

`Content-Type: text/event-stream`. Each line is `data: {json}\n\n`:

| `type` | Payload |
| --- | --- |
| `delta` | `{ "type": "delta", "text": "..." }` |
| `done` | `{ "type": "done", "usage": { ... }, "model": "...", "provider": "...", "finishReason": "stop" }` |
| `error` | `{ "type": "error", "message": "..." }` |

**Telemetry:** successful completions emit `completion.requested` server-side with `metadata.latencyMs` and `metadata.fim`.

When `useGraphContext` is `true`, responses may include `x-graph-context: degraded` if the graph slice timed out or was unavailable.

**Errors:** `400` invalid request, `401` unauthorized, `429` rate limited, `502` provider failure

## Graph (Pro and Enterprise)

- `GET /graph/:repoId/search?pattern=handler`
- `GET /graph/:repoId/ownership?file=...`

Returns `403` with `plan_required` on free plans.

## Zero-clone manifest (all plans)

- `GET /v1/orgs/repos/:repoId/manifest` — structure-only manifest (paths and symbols)

## Environment variables (self-hosted)

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic provider |
| `OPENAI_API_KEY` | OpenAI provider |
| `MISTRAL_API_KEY` | Mistral Codestral (FIM inline completion) |
| `DEEPSEEK_API_KEY` | DeepSeek (FIM inline completion) |
| `COOP_LLM_DEFAULT_PROVIDER` | Default provider (`anthropic`) |
| `COOP_LLM_MOCK` | `true` = mock stream without provider keys |
| `COOP_REQUIRE_API_AUTH` | Require Bearer token (production: `true`) |

See [Zero-retention LLM routing](/docs/zero-retention) and [Enterprise deployment](/docs/enterprise-deployment).
