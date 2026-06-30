# CoopAI API v1

All routes are served from the same host as graph, jobs, and webhooks (`coopAI.apiBaseUrl`).

## Authentication

```http
Authorization: Bearer <org-api-key>
```

Create org API keys with `npm run admin:org -- create-api-key <orgId> <label>`. Chat and inline completion require a valid org key when `COOP_REQUIRE_API_AUTH=true` (production default).

In local development with `COOP_REQUIRE_API_AUTH=false` and no Bearer token, the server accepts requests and audits them as `orgId: dev`, `plan: free`.

Legacy `COOP_JOBS_API_TOKEN` / `COOP_API_TOKEN` still work for `/api/jobs` and as a migration fallback for other authenticated routes; they do **not** gate `/v1/chat`.

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

Batch or streaming completion for editor ghost text (`useCase: inline_completion`). Same auth as `/v1/chat`.

**Request body**

| Field | Type | Notes |
|-------|------|-------|
| `message` | string? | Prompt with surrounding code context (chat-fallback mode) |
| `segments` | object? | FIM mode: `{ prefix, suffix }` — requires `prefix` if `message` omitted |
| `segments.prefix` | string | Code before cursor (max 4,000 chars) |
| `segments.suffix` | string? | Code after cursor (max 2,000 chars) |
| `stream` | boolean? | `true` → SSE (`text/event-stream`); default `false` → JSON |
| `repoId` | string? | Repo metadata for quota/audit |
| `languageId` | string? | VS Code language id |
| `file` | string? | File path (metadata only) |
| `provider` | string? | `anthropic` \| `openai` \| `deepseek` \| `gemini` \| `mistral` |
| `model` | string? | Fast model recommended (e.g. Haiku, `codestral-latest`) |
| `maxTokens` | number? | Default 96, cap 128 |
| `temperature` | number? | Default 0.15 |

**Validation:** require `message` **or** `segments.prefix` (non-empty after trim).

**FIM routing (server-side):** when `segments.prefix` is present, the API prefers Mistral Codestral FIM (`MISTRAL_API_KEY`), then DeepSeek FIM beta (`DEEPSEEK_API_KEY`), otherwise chat-fallback using `message`.

**Response** `200` (JSON, `stream` omitted or `false`)

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

**Response** `200` (`stream: true`)

`Content-Type: text/event-stream`. Each line is `data: {json}\n\n` with the same chunk shapes as `/v1/chat`:

| `type` | Payload |
|--------|---------|
| `delta` | `{ "type": "delta", "text": "..." }` |
| `done` | `{ "type": "done", "usage": { ... }, "model": "...", "provider": "...", "finishReason": "stop" }` |
| `error` | `{ "type": "error", "message": "..." }` |

## Graph (Pro and Enterprise)

- `GET /graph/:repoId/search?pattern=handler`
- `GET /graph/:repoId/ownership?file=...`
- Returns `403` with `plan_required` on Free plans.
- See [webhook-backend.md](./webhook-backend.md)

## Zero-Clone (all plans)

- `GET /v1/orgs/repos/:repoId/manifest` — structure-only manifest (paths and symbols).
- `POST /v1/chat` — chat with client-supplied context (no full-repo graph required).

## Server environment

| Variable | Purpose |
|----------|---------|
| `COOP_API_TOKEN` / `COOP_JOBS_API_TOKEN` | Legacy Bearer auth for `/api/jobs` (and migration fallback on other routes) |
| Org API keys (database) | Bearer auth for `/v1/chat`, `/v1/completions/inline`, `/v1/me`, graph, etc. |
| `COOP_LLM_DEFAULT_PROVIDER` | Default provider (`anthropic`) |
| `COOP_LLM_MOCK` | `true` = mock stream without provider keys |
| `COOP_LLM_ALLOW_UNAPPROVED` | `true` = allow DeepSeek for enterprise |
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENAI_API_KEY` | OpenAI |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `MISTRAL_API_KEY` | Mistral Codestral (FIM inline) |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Gemini |
