---
title: Extension settings
description: Account, Tools, Workspace, and Preferences in the Coop AI extension.
section: extension
order: 1
lastUpdated: "2026-06-29"
---

Open settings: Coop sidebar → gear icon, or Command Palette → **Coop AI: Open Settings**.

## Account

![Coop extension Settings — Account tab with API key, API base URL, and Test connection](/screenshots/docs/settings-account-light.svg)

*Settings → Account: paste your CoopAI API key, set the API base URL, then click **Test connection**.*

| Field | Value |
| --- | --- |
| **Coop AI API key** | Bearer token from free signup or org admin |
| **API base URL** | `https://api.coop-ai.dev` (default) or your self-hosted URL |

Click **Test connection** to verify `GET /health`.

## Tools

Shows connection status for code hosts and integrations.

| Mode | Behavior |
| --- | --- |
| **Production** (`coopAI.devMode: false`) | Read-only status. Org admins connect in the [admin portal](/docs/admin-portal). |
| **Developer** (`coopAI.devMode: true`) | Paste PATs/tokens in VS Code SecretStorage for local testing. |

Supported tools: GitHub, GitLab, Bitbucket, Slack, Jira, Confluence, Notion, Google Docs, Microsoft Teams.

## Workspace

| Field | Purpose |
| --- | --- |
| **Owner** | GitHub/GitLab org or user (e.g. `acme`) |
| **Repository** | Repo name (e.g. `api`) |
| **Branch** | Default branch (e.g. `main`) |

Repo-wide quick actions (**Understand Repo**, **Find Owner**, **Knowledge Gaps**) use these defaults.

## Preferences

- **Prompt library** — pin up to 5 prompts for the composer footer
- **Model preferences** — default provider/model where applicable
- **Dev mode** — enable PAT-based local integration testing (not for production orgs)

## Production vs developer mode

| | Production | Developer mode |
| --- | --- | --- |
| **Setting** | `coopAI.devMode: false` | `coopAI.devMode: true` |
| **Credentials** | Coop server (org OAuth) | VS Code SecretStorage |
| **Who connects** | Org admin | Individual developer |

Enterprise customers should keep dev mode **off** in workspace settings.

## Command Palette shortcuts

| Command | Action |
| --- | --- |
| **Coop AI: Open Settings** | Settings hub |
| **Coop AI: Focus Chat** | Open sidebar chat |
| **Coop AI: Understand Repo** | Run Understand Repo quick action |
| **Coop AI: Trace Decision** | Run Trace Decision (file required) |

See the [Owner's Manual](/manual#using-the-extension) for chat composer, slash commands, and inline complete.
