---
title: API reference
description: Coop AI API v1 — chat, inline completion, health, and authentication.
section: api
order: 1
lastUpdated: "2026-06-29"
---

All routes are served from your API base URL (`https://api.coop-ai.dev` or self-hosted).

## Authentication

```http
Authorization: Bearer <org-api-key>
```

Org API keys are created in the admin portal or during signup. Chat and inline completion require a valid key when `COOP_REQUIRE_API_AUTH=true` (production default).

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

Use **Test connection** in the extension to call this endpoint.

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

Batch completion for editor ghost text. Same auth as chat.

**Request:**

| Field | Notes |
| --- | --- |
| `message` | Prompt with surrounding code context |
| `languageId` | VS Code language id |
| `file` | File path (metadata) |
| `maxTokens` | Default 96, cap 128 |
| `temperature` | Default 0.15 |

Uses header `x-use-case: code-completion-only` for zero-retention routing.

**Response:**

```json
{
  "text": "completion text only",
  "model": "claude-3-haiku-20240307",
  "provider": "anthropic",
  "latencyMs": 120
}
```

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
| `COOP_LLM_DEFAULT_PROVIDER` | Default provider (`anthropic`) |
| `COOP_LLM_MOCK` | `true` = mock stream without provider keys |
| `COOP_REQUIRE_API_AUTH` | Require Bearer token (production: `true`) |

See [Zero-retention LLM routing](/docs/zero-retention) and [Enterprise deployment](/docs/enterprise-deployment).
