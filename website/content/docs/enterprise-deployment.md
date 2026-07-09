---
title: Enterprise deployment
description: Self-hosted CoopAI on Railway or your infrastructure.
section: enterprise
order: 3
lastUpdated: "2026-06-29"
---

Enterprise customers can deploy CoopAI on their own infrastructure with full control over data residency and LLM routing.

## Deployment options

| Option | Best for |
| --- | --- |
| **Hosted Coop** (`api.coop-ai.dev`) | Fastest start; Coop manages infrastructure |
| **Self-hosted (Railway)** | Single-tenant on Railway with your env vars |
| **Self-hosted (Docker)** | Full control on your VPC |

Contact [hello@coop-ai.dev](mailto:hello@coop-ai.dev) for Enterprise licensing and deployment support.

## Core components

| Service | Purpose |
| --- | --- |
| **API** | Chat, completions, webhooks, integrations |
| **Postgres** | Orgs, users, API keys, integration tokens |
| **Redis** (optional) | Job queue, caching |
| **Admin portal** | Org admin UI (`admin.coop-ai.dev` or self-hosted) |

## Required environment variables

Copy `.env.backend.example` to `.env.backend` on your API host:

| Category | Variables |
| --- | --- |
| **Core** | `DATABASE_URL`, `CREDENTIALS_ENCRYPTION_KEY`, `COOP_PUBLIC_BASE_URL` |
| **LLM** | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. |
| **GitHub** | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG` |
| **Slack** | `SLACK_APP_CLIENT_ID`, `SLACK_APP_CLIENT_SECRET` |
| **Atlassian** | `ATLASSIAN_APP_CLIENT_ID`, `ATLASSIAN_APP_CLIENT_SECRET` |
| **Notion** | `NOTION_APP_CLIENT_ID`, `NOTION_APP_CLIENT_SECRET` |
| **Google** | `GOOGLE_DOCS_APP_CLIENT_ID`, `GOOGLE_DOCS_APP_CLIENT_SECRET` |

## Deploy with Docker

```bash
docker compose up -d --build api
```

Verify: `curl https://your-api-host/health` returns `"ok": true`.

## OAuth callback URLs

Register these redirect URIs in each vendor console:

| Provider | Callback |
| --- | --- |
| GitHub | `https://your-api-host/v1/github/app/callback` |
| Slack | `https://your-api-host/v1/slack/app/callback` |
| Atlassian | `https://your-api-host/v1/atlassian/app/callback` |
| Notion | `https://your-api-host/v1/notion/app/callback` |
| Google Docs | `https://your-api-host/v1/google-docs/app/callback` |

## Lightning Mode (Pro/Enterprise)

Lightning Mode indexes repos on Coop cloud infrastructure for faster symbol-graph retrieval. Self-hosted Enterprise can enable managed indexing or run index jobs locally.

## Webhooks

Configure GitHub/GitLab webhooks pointing to:

```
https://your-api-host/webhooks/github
```

Coop processes push and PR events to update the code graph.

## Admin portal

- **API server** — set `COOP_ADMIN_PORTAL_URL` to your admin portal origin (used in emails and redirects).
- **Admin Next.js deploy** — set `NEXT_PUBLIC_ADMIN_PORTAL_URL` to the same origin (client-side links).

Developers and admins use the portal for org configuration.

## Next steps

- [Connect integrations](/docs/connect-integrations)
- [Security architecture](/docs/security-architecture)
- [Enterprise product page](/enterprise)
