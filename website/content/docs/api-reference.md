---
title: API reference
description: CoopAI API v1 — chat, inline completion, health, and authentication.
section: api
order: 1
lastUpdated: "2026-07-09"
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

## Graph (all plans)

- `GET /graph/:repoId/search?pattern=handler`
- `GET /graph/:repoId/ownership?file=...`

Available on Free, Pro, and Enterprise when the repo is Deep-Indexed. Free orgs are limited to 3 Deep-Indexed repos org-wide.

## Zero-clone manifest (all plans)

- `GET /v1/orgs/repos/:repoId/manifest` — structure-only manifest (paths and symbols)

## SSO configuration (Enterprise)

Org admins configure SAML in the [admin portal](/docs/admin-portal) or via these APIs. All routes require **Enterprise** plan.

### Auth requirements

| Endpoint | Who can call |
| --- | --- |
| `GET /v1/sso/config` | Org **admin** or **owner** (session bearer) or org API key on Enterprise (`admin_required` for members) |
| `GET /v1/sso/policy` | Any signed-in org member (session bearer) or org API key on Enterprise |
| `PUT /v1/sso/config`, `PUT /v1/sso/policy` | Org **admin** or **owner** only (`admin_required` for members) |
| `GET /v1/auth/saml/start` | **Public** — no bearer token |
| `POST /v1/auth/saml/callback` | **Public** — browser POST from your IdP (no Coop bearer) |
| `GET /v1/auth/saml/metadata` | Enterprise bearer (session or org API key) |
| `POST /v1/auth/saml/offboard` | Enterprise bearer (session or org API key) |

Session bearer: `Authorization: Bearer coop_sess_…` from extension or admin portal sign-in. Org API keys (`coop_…`) work for automation but do **not** satisfy interactive sign-in when `requireSso` is enabled — see [SAML SSO troubleshooting](/docs/saml-sso-troubleshooting).

### `GET /v1/sso/config`

Returns IdP configuration and service provider (SP) values for your org. **Admin only** (org API keys also allowed).

**Response** `200` (not configured):

```json
{
  "configured": false,
  "sp": {
    "entityId": "https://api.coop-ai.dev/v1/auth/saml/metadata",
    "acsUrl": "https://api.coop-ai.dev/v1/auth/saml/callback",
    "metadataUrl": "https://api.coop-ai.dev/v1/auth/saml/metadata",
    "publicStartUrl": "https://api.coop-ai.dev/v1/auth/saml/start"
  }
}
```

**Response** `200` (configured): adds `provider`, `idpEntityId`, `idpSsoUrl`, `enabled`, `hasCertificate`, `updatedAt`. The raw `idpX509Cert` is never returned.

**Errors:** `401` unauthorized, `403` `admin_required` \| `plan_required`, `503` `sso_unavailable`

### `PUT /v1/sso/config`

Save or update IdP settings. **Admin only.**

**Request body:**

| Field | Type | Notes |
| --- | --- | --- |
| `provider` | string | `okta` \| `azuread` \| `saml` |
| `idpEntityId` | string | IdP entity ID / issuer |
| `idpSsoUrl` | string | IdP SSO URL (HTTP-Redirect) |
| `idpX509Cert` | string? | PEM or base64 signing cert; omit on update to keep existing cert |
| `enabled` | boolean? | Default `true` when saving |

**Errors:** `400` `invalid_request` \| `invalid_certificate` \| `sso_required_active` (cannot disable SAML while **Require SSO** is on), `403` `admin_required` \| `plan_required`, `503` `sso_unavailable`

### `GET /v1/sso/policy`

Returns sign-in policy for the org.

```json
{
  "requireSso": false,
  "allowPassword": true,
  "allowGoogle": true,
  "updatedAt": "2026-07-09T12:00:00.000Z"
}
```

When `requireSso` is `true`, password and Google sign-in are blocked at login (`sso_required`). Existing sessions remain valid until expiry.

**Errors:** `401` unauthorized, `403` `plan_required`, `503` `sso_unavailable`

### `PUT /v1/sso/policy`

Update sign-in policy. **Admin only.**

**Request body** (all fields optional):

| Field | Type | Notes |
| --- | --- | --- |
| `requireSso` | boolean? | Block password/Google for new sign-ins |
| `allowPassword` | boolean? | Ignored when `requireSso` is `true` |
| `allowGoogle` | boolean? | Ignored when `requireSso` is `true` |

**Errors:** `400` `sso_not_configured` when enabling `requireSso` before SSO is saved and enabled, `403` `admin_required` \| `plan_required`, `503` `sso_unavailable`

## SAML authentication (Enterprise)

Coop uses a **shared service provider** for all Enterprise tenants. Your org is resolved from **RelayState** at callback time.

### `GET /v1/auth/saml/start`

Public SSO entry for the extension and admin portal. Redirects (302) to your IdP, or returns JSON when `format=json`.

**Query parameters:**

| Param | Required | Notes |
| --- | --- | --- |
| `org` or `orgId` | Yes | Organization name (case-insensitive) or UUID |
| `redirect` | No | Allowed callback URL after sign-in (admin portal or extension) |
| `format` | No | `json` → `{ "redirectUrl": "…" }` instead of 302 |

**Errors:** `400` `missing_org`, `403` `plan_required`, `409` `sso_not_configured`, `502` `sso_login_failed`

### `POST /v1/auth/saml/callback`

IdP ACS endpoint. Accepts `application/x-www-form-urlencoded` with `SAMLResponse` and `RelayState`. On success, sets a session cookie/token and redirects to `redirect` from RelayState.

**Errors:** `400` `missing_saml_response` \| `missing_relay_state`, `401` `saml_validation_failed`, `403` `plan_required` \| `sso_not_configured`

### `GET /v1/auth/saml/metadata`

SP metadata XML (`application/samlmetadata+xml`). Same Entity ID and ACS URL for every tenant. **Enterprise bearer required.**

### `POST /v1/auth/saml/offboard`

Deactivate users when they are removed from your IdP. **Enterprise bearer required.**

**Request body** (provide one):

| Body | Behavior |
| --- | --- |
| `{ "userId": "…" }` | Deactivate a single user in your org |
| `{ "idpSubject": "…" }` | Deactivate by IdP NameID / subject |
| `{ "activeSubjects": ["…", "…"] }` | SCIM-style sync — deactivate everyone else with SAML identities for this provider |

**Response** `200`: `{ "ok": true, … }` with `deactivated` or `deactivatedIds` as applicable.

See [SAML SSO](/docs/saml-sso) for IdP setup and operator smoke-test steps in the repo `docs/sso-smoke-test.md`.

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
| `COOP_PUBLIC_BASE_URL` | Public API base — required for SAML SP URLs and callbacks |
| `COOP_SSO_SP_ENTITY_ID` | Optional SP entity ID override (default: metadata URL) |
| `COOP_SSO_SESSION_TTL_MS` | SAML session lifetime in ms (default: 12 hours) |

See [Zero-retention LLM routing](/docs/zero-retention), [Enterprise deployment](/docs/enterprise-deployment), and [SAML SSO](/docs/saml-sso).
