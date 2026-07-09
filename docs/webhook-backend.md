# Webhook Backend

**Updated:** July 9, 2026

CoopAI's webhook backend ingests provider events, verifies signatures, normalizes payloads, and updates a remote repository graph without cloning repositories locally.

## Runtime

Build and start the backend:

```sh
npm run build:backend
npm run build:workers
npm run start:webhooks
```

Run job workers separately (recommended in production):

```sh
JOBS_WORKERS=0 npm run start:webhooks   # API only
npm run start:workers                   # workers only
```

Or use Docker Compose:

```sh
docker compose up --build
```

Apply migrations on Postgres:

**Fresh database** (new Docker volume): migrations in `migrations/` run automatically via `docker-entrypoint-initdb.d`.

**Existing database** (upgrade path): use the migration runner, which tracks applied files in `schema_migrations`:

```sh
export DATABASE_URL=postgres://coop:coop@localhost:5432/coopai
chmod +x scripts/migrate.sh
./scripts/migrate.sh
```

To apply a single migration manually:

```sh
psql "$DATABASE_URL" -f migrations/001_jobs.sql
# ... through migrations/013_org_billing.sql
```

Current migrations: `001_jobs` through `013_org_billing` (jobs, orgs, graph cache, manifests, billing, collections, users, integrations, etc.).

The server listens on `PORT` or `8787` by default.

## Authentication

In production (`COOP_REQUIRE_API_AUTH=true`), protected routes require `Authorization: Bearer <api-key>`.

Org API keys are created with:

```sh
npm run build:admin
npm run admin:org -- create-org "Acme Corp" pro
npm run admin:org -- create-api-key <orgId> primary
```

Legacy single-token auth via `COOP_API_TOKEN` remains supported during migration.

## Endpoints

- `GET /health` returns server, cache, webhook, job, and LLM provider health.
- `GET /v1/me` returns org id, plan, and Lightning entitlement (requires auth).
- `POST /v1/orgs/credentials/github` stores encrypted GitHub PAT for cloud indexing.
- `GET /v1/orgs/repos` lists org repos and Lightning index status.
- `POST /v1/orgs/repos/:repoId/lightning/enable` enqueues cloud index job (Pro or Enterprise; 403 otherwise).
- `POST /v1/orgs/repos/:repoId/lightning/disable` disables Lightning for a repo (Pro+).
- `GET /v1/orgs/repos/:repoId/lightning/status` returns index status for a repo (Pro+).
- `GET /v1/orgs/repos/:repoId/manifest` returns Zero-Clone structure manifest (all plans).
- `POST /v1/chat` streams chat completions (org API key; all plans — see [api-v1.md](./api-v1.md)).
- `POST /v1/completions/inline` inline editor completions (same auth as chat).
- `GET /webhooks/health` returns webhook delivery and registration health.
- `POST /webhooks/github` accepts GitHub webhook deliveries.
- `POST /webhooks/gitlab` accepts GitLab webhook deliveries.
- `POST /webhooks/slack` accepts Slack Events API deliveries.
- `GET /graph/:repoId/*` graph queries (Pro+; requires auth in production).
- `GET /v1/sso/config` and `PUT /v1/sso/config` — read/save SAML IdP configuration (**Enterprise org admin** bearer only; members get `403 admin_required`). `PUT` returns `400 sso_required_active` if disabling SAML while **Require SSO** is on.
- `GET /v1/sso/policy` and `PUT /v1/sso/policy` — SSO sign-in policy (`requireSso`, `allowPassword`, `allowGoogle`); GET any org member, PUT admin only.
- `GET /v1/auth/saml/start` — public SP-initiated SSO entry (`?org={name}`; case-insensitive org lookup).
- `GET /v1/auth/saml/metadata` — SP metadata XML (Enterprise bearer).
- `POST /v1/auth/saml/callback` — IdP ACS callback (browser POST).
- `POST /v1/auth/saml/offboard` — deactivate users by IdP subject (Enterprise bearer).
- `/v1/self-host/*` reserved for Enterprise (501 until implemented).
- `GET /rate-limits` provider quota state (requires auth in production).
- `GET /token-pools` token pool metadata (requires auth in production).
- Job queue API under `/api/jobs` (see [job-queue.md](./job-queue.md)).

`repoId` uses the normalized form `github:owner/repo` or `gitlab:owner/repo` and must be URL encoded when it appears in a path.

## Configuration

The backend reads environment variables through `src/config/webhookConfig.ts`.

```sh
PORT=8787
NODE_ENV=production
COOP_REQUIRE_API_AUTH=true
COOP_PUBLIC_BASE_URL=https://api.coop-ai.dev
DATABASE_URL=postgres://coop:coop@localhost:5432/coopai
JOBS_BACKEND=postgres
GRAPH_CACHE_BACKEND=postgres
JOBS_WORKERS=0
CREDENTIALS_ENCRYPTION_KEY=
WEBHOOK_DOMAIN=https://coop-api.example.com
GITHUB_WEBHOOK_SECRET=whsec_...
GITLAB_WEBHOOK_TOKEN=...
SLACK_SIGNING_SECRET=...
GRAPH_CACHE_TTL_SECONDS=86400
GRAPH_CACHE_MAX_REPOS=100
RATE_LIMIT_WARN_THRESHOLD=0.2
COOP_API_TOKEN=
COOP_SSO_SP_ENTITY_ID=
COOP_SSO_SESSION_TTL_MS=43200000
```

`COOP_PUBLIC_BASE_URL` is **operator-only** — the public HTTPS base of this API host. SAML SP Entity ID, ACS URL, and OAuth redirect URIs derive from it; org admins configure IdP values in the admin portal at `/settings/single-sign-on`, not this env var.

See [`.env.backend.example`](../.env.backend.example) for a full template.

For self-hosted deployments, set `WEBHOOK_DOMAIN` to the public HTTPS domain that providers can reach. Local development usually needs a tunnel such as Cloudflare Tunnel or ngrok, then the tunnel URL becomes `WEBHOOK_DOMAIN`.

## Cache Policy

The memory cache stores repository metadata only:

- File paths, sizes, timestamps, authors, and SHAs.
- Commit summaries.
- Dependency edges.
- Ownership scores.
- PR, issue, review, branch, and Slack decision metadata.

The cache must not store raw source code, Slack message bodies, wholesale provider API responses, or credentials. Use `GRAPH_CACHE_BACKEND=postgres` with `DATABASE_URL` for durable graph metadata across restarts.

## Provider Setup

GitHub should send `push`, `pull_request`, `pull_request_review`, `issues`, and `repository` events to `/webhooks/github`. GitHub signatures are verified with `X-Hub-Signature-256`.

GitLab should send push, merge request, issue, and wiki events to `/webhooks/gitlab`. GitLab tokens are verified with `X-Gitlab-Token`.

Slack should send Events API requests to `/webhooks/slack`. Slack requests are verified with `X-Slack-Signature` and `X-Slack-Request-Timestamp`. Message bodies are inspected only to extract decision keywords and repository references, then discarded.

## Production Notes

The included `PlaceholderWebhookClient` records webhook registration intent but does not call provider APIs. Replace it with GitHub App, GitLab project hook, and Slack app clients when app credentials and installation flows are available.

For multi-instance deployments, replace memory cache, dedupe, audit trail, and token pool state with Redis/PostgreSQL-backed adapters before running more than one process.
