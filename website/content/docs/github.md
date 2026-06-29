---
title: GitHub
description: Connect GitHub for repo indexing, PR history, and CODEOWNERS.
section: integrations
order: 3
lastUpdated: "2026-06-29"
---

In production, GitHub connects through the browser — not a pasted PAT in VS Code.

## Org admin — connect GitHub

1. **Admin portal** → Integrations → **Connect GitHub**
2. **Browser** — Approve OAuth or GitHub App install
3. Return to admin portal → **Test GitHub**

**Success:** GitHub row shows Connected.

## What Coop uses GitHub for

- Webhook-driven repo indexing (push, PR events)
- CODEOWNERS and blame for **Find Owner**
- PR and commit history for **Trace Decision**
- Symbol graph and dependency analysis (Pro Lightning Mode)

## GitHub App vs OAuth

Hosted Coop at `api.coop-ai.dev` uses a **GitHub App** for org-wide installation. Self-hosted operators can configure either:

| Mode | Best for |
| --- | --- |
| **GitHub App** | Production, org-wide repo access |
| **OAuth App** | Local dev, small teams |

## Workspace settings

After GitHub is connected, each developer sets **Settings → Workspace**:

- Owner (org or user)
- Repository name
- Default branch

## Developer mode (local only)

With `coopAI.devMode: true`, paste a GitHub PAT in **Settings → Tools → GitHub**.

Suggested scopes: `repo`, `read:org`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "GitHub is not configured on the Coop server" | Operator must add GitHub App/OAuth creds |
| "Sign in to Coop first" | Save org API key under Account |
| Callback fails | Callback URL must match vendor console exactly |
| Still see PAT field | Disable `coopAI.devMode` for production |

## Coop API key vs GitHub

- **Coop API key** — identifies your org to the Coop backend
- **Connect GitHub** — authorizes GitHub; stores tokens on the server

Both are required in production mode.
