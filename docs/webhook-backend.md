# Webhook Backend

CoopAI's webhook backend ingests provider events, verifies signatures, normalizes payloads, and updates a remote repository graph without cloning repositories locally.

## Runtime

Build and start the backend:

```sh
npm run build:backend
npm run start:webhooks
```

The server listens on `PORT` or `8787` by default.

## Endpoints

- `GET /health` returns server, cache, webhook, job, and LLM provider health.
- `POST /v1/chat` streams chat completions (see [api-v1.md](./api-v1.md)).
- `POST /v1/completions/inline` returns `501` until autocomplete is implemented.
- `GET /webhooks/health` returns webhook delivery and registration health.
- `POST /webhooks/github` accepts GitHub webhook deliveries.
- `POST /webhooks/gitlab` accepts GitLab webhook deliveries.
- `POST /webhooks/slack` accepts Slack Events API deliveries.
- `GET /graph/:repoId/tree` returns cached file structure.
- `GET /graph/:repoId/ownership?file=src/index.ts` returns ownership metadata.
- `GET /graph/:repoId/dependents?file=src/index.ts` returns direct dependents.
- `GET /graph/:repoId/transitive-dependents?file=src/index.ts` returns blast-radius dependents.
- `GET /graph/:repoId/changes?days=7` returns recent commits.
- `GET /graph/:repoId/search?pattern=handler` searches cached file paths.
- `GET /rate-limits` returns provider quota state and burn-rate predictions.
- `GET /token-pools` returns safe token metadata without token values.
- Job queue API under `/api/jobs` (see [job-queue.md](./job-queue.md)).

`repoId` uses the normalized form `github:owner/repo` or `gitlab:owner/repo` and must be URL encoded when it appears in a path.

## Configuration

The backend reads environment variables through `src/config/webhookConfig.ts`.

```sh
PORT=8787
WEBHOOK_DOMAIN=https://coop-api.example.com
GITHUB_WEBHOOK_SECRET=whsec_...
GITLAB_WEBHOOK_TOKEN=...
SLACK_SIGNING_SECRET=...
GRAPH_CACHE_BACKEND=memory
GRAPH_CACHE_TTL_SECONDS=86400
GRAPH_CACHE_MAX_REPOS=100
RATE_LIMIT_WARN_THRESHOLD=0.2
GITHUB_TOKEN_POOL=ghp_token_one,ghp_token_two
GITHUB_TOKEN_POOL_STRATEGY=round-robin
```

For self-hosted deployments, set `WEBHOOK_DOMAIN` to the public HTTPS domain that providers can reach. Local development usually needs a tunnel such as Cloudflare Tunnel or ngrok, then the tunnel URL becomes `WEBHOOK_DOMAIN`.

## Cache Policy

The memory cache stores repository metadata only:

- File paths, sizes, timestamps, authors, and SHAs.
- Commit summaries.
- Dependency edges.
- Ownership scores.
- PR, issue, review, branch, and Slack decision metadata.

The cache must not store raw source code, Slack message bodies, wholesale provider API responses, or credentials. The initial implementation is memory-first with TTL and LRU eviction. Redis/PostgreSQL adapters can be added behind the cache boundary later for durability.

## Provider Setup

GitHub should send `push`, `pull_request`, `pull_request_review`, `issues`, and `repository` events to `/webhooks/github`. GitHub signatures are verified with `X-Hub-Signature-256`.

GitLab should send push, merge request, issue, and wiki events to `/webhooks/gitlab`. GitLab tokens are verified with `X-Gitlab-Token`.

Slack should send Events API requests to `/webhooks/slack`. Slack requests are verified with `X-Slack-Signature` and `X-Slack-Request-Timestamp`. Message bodies are inspected only to extract decision keywords and repository references, then discarded.

## Production Notes

The included `PlaceholderWebhookClient` records webhook registration intent but does not call provider APIs. Replace it with GitHub App, GitLab project hook, and Slack app clients when app credentials and installation flows are available.

For multi-instance deployments, replace memory cache, dedupe, audit trail, and token pool state with Redis/PostgreSQL-backed adapters before running more than one process.
