# CoopAI API v1

All routes are served from the same host as graph, jobs, and webhooks (`coopAI.apiBaseUrl`).

## Authentication

```http
Authorization: Bearer <COOP_API_TOKEN>
```

The token matches `COOP_JOBS_API_TOKEN` / `COOP_API_TOKEN` on the server. If no token is configured on the server, auth is skipped (development only).

## Health

### `GET /health`

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

## Chat

### `POST /v1/chat`

Streams assistant output as Server-Sent Events.

**Request**

```json
{
  "message": "Why was this handler written this way?",
  "history": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }],
  "context": {
    "owner": "acme",
    "repo": "api",
    "branch": "main",
    "file": "src/handler.ts",
    "selectedLines": [10, 42],
    "contextBundle": {}
  },
  "mentions": [],
  "model": "claude-3-5-sonnet-20241022",
  "provider": "anthropic",
  "useCase": "decision_archaeology",
  "temperature": 0.5,
  "maxTokens": 2000,
  "stream": true
}
```

**`useCase` values:** `comprehension` | `decision_archaeology` | `ownership` | `blast_radius` | `knowledge_gaps` | `chat` | `inline_completion`

**SSE events** (`data: ` JSON lines)

| `type` | Fields |
|--------|--------|
| `delta` | `text` |
| `done` | `usage`, `model`, `provider`, `finishReason` |
| `error` | `message`, `code?` |

**Errors:** `401` unauthorized, `429` rate limited, `502` provider failure

## Inline completion

### `POST /v1/completions/inline`

Batch completion for editor ghost text (`useCase: inline_completion`). Same auth as `/v1/chat`.

**Request body**

| Field | Type | Notes |
|-------|------|-------|
| `message` | string | Prompt with surrounding code context |
| `languageId` | string? | VS Code language id |
| `file` | string? | File path (metadata only) |
| `provider` | string? | `anthropic` \| `openai` \| … |
| `model` | string? | Fast model recommended (e.g. Haiku) |
| `maxTokens` | number? | Default 96, cap 128 |
| `temperature` | number? | Default 0.15 |

**Response** `200`

```json
{
  "text": "completion text only",
  "alternatives": [],
  "model": "claude-3-haiku-20240307",
  "provider": "anthropic",
  "latencyMs": 120
}
```

## Graph (existing)

- `GET /graph/:repoId/search?pattern=handler`
- `GET /graph/:repoId/ownership?file=...`
- See [webhook-backend.md](./webhook-backend.md)

## Server environment

| Variable | Purpose |
|----------|---------|
| `COOP_API_TOKEN` / `COOP_JOBS_API_TOKEN` | Bearer auth for `/v1/*` and `/api/jobs` |
| `COOP_LLM_DEFAULT_PROVIDER` | Default provider (`anthropic`) |
| `COOP_LLM_MOCK` | `true` = mock stream without provider keys |
| `COOP_LLM_ALLOW_UNAPPROVED` | `true` = allow DeepSeek for enterprise |
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENAI_API_KEY` | OpenAI |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Gemini |
