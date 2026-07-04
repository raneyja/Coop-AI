---
title: Connect integrations
description: Org admin checklist for connecting GitHub, Slack, Jira, and other tools.
section: integrations
order: 1
lastUpdated: "2026-07-04"
---

In **production mode** (`coopAI.devMode: false`), integration tokens live on the Coop server — not in VS Code. Org admins connect once for the whole organization in the [admin portal](https://admin.coop-ai.dev).

## Prerequisites

- Admin account with access to [admin.coop-ai.dev](https://admin.coop-ai.dev) (sign in with email/password or Google)
- Coop operator has configured OAuth apps on the API server (hosted Coop handles this automatically)

## 5-minute checklist

**Browser** — Admin portal → [Integrations](https://admin.coop-ai.dev/integrations)

| # | Integration | Success |
| --- | --- | --- |
| 1 | **GitHub** → **Connect (GitHub App)** or **Send link to GitHub admin** → install on company org → **Refresh** → Test | Connected |
| 2 | **Slack** → Connect → approve → Test | Connected |
| 3 | **Jira** → Connect + set Jira site URL → Test | Connected |
| 4 | **Confluence** → Connect + set site URL → Test | Connected |
| 5 | **Notion** → Connect → Test | Connected |
| 6 | **Google Docs** → Connect → Test | Connected |
| 7 | **Microsoft Teams** → Connect → Test | Connected |
| 8 | **Indexing** → Configure GitHub → Deep-Index company repos | Repos **ready** |
| 9 | **Extension UI** → **Workspace** → owner / repo / branch | Saved |

For GitHub, company repos must be installed on a **GitHub Organization** — see [GitHub](/docs/github).

Admins with owner/admin role can also connect from **Extension UI → Settings → Tools**; the admin portal is recommended for GitHub org install and scope management.

## What each integration enables

| Tool | Coop features powered |
| --- | --- |
| **GitHub / GitLab / Bitbucket** | Repo indexing, PR history, CODEOWNERS, blame |
| **Slack** | Trace Decision, Knowledge Gaps with thread context |
| **Jira** | Ticket-linked decision archaeology |
| **Confluence / Notion / Google Docs** | Documentation cross-reference in answers |
| **Teams** | Thread context (work/school Microsoft 365) |

## Per-integration guides

- [GitHub](/docs/github)
- [Slack](/docs/slack)
- [Jira](/docs/jira)
- [Notion](/docs/notion)
- [Google Docs](/docs/google-docs)

## Developer mode (local testing only)

Individual developers can paste PATs in **Extension UI** → Settings → Tools when `coopAI.devMode: true`. Do not use dev mode for production orgs.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| 503 / not configured | Contact Coop operator — OAuth apps not registered on server |
| 403 admin required | Sign in with an owner or admin account (not a developer-only account) |
| GitHub “Waiting for GitHub” stuck | Finish install on GitHub (org, not personal) → **Refresh**; or **Connect** again for auto-relink |
| Redirect URI mismatch | Operator must fix callback URL in vendor console |
| Empty search results | Set Workspace owner/repo; ensure indexed content references your repo |

See [Troubleshooting](/docs/troubleshooting) for more.

## Next steps

- [Integration scope](/docs/integration-scope) — limit which channels/projects Coop accesses
- [Extension settings](/docs/extension-settings) — workspace configuration
