# Integration onboarding

How to connect external tools to Coop AI.

Open settings: Coop AI sidebar → gear icon, or Command Palette → **Coop AI: Open Settings**.

---

## Production vs developer mode

| Mode | Setting | Where credentials live | Who sets up integrations |
|------|---------|------------------------|---------------------------|
| **Production** | `coopAI.devMode: false` | Coop **server** (org OAuth) | [Org admin self-serve Connect](./connect-integrations-production.md) |
| **Developer** | `coopAI.devMode: true` | VS Code **SecretStorage** (PATs/tokens) | Individual developer |

**Enterprise onboarding plan (operators + customers):** [enterprise-integration-onboarding.md](./enterprise-integration-onboarding.md)

In production, developers do **not** paste Slack, Notion, or Google tokens. Org admins use **Settings → Connections → Connect**.

---

## Quick start (minimum to use Coop AI)

| Step | What | Required? |
|------|------|-----------|
| 1 | [Coop API key](#1-coop-api) | Yes |
| 2 | [Code host](#2-code-hosts-github--gitlab--bitbucket) — **Connect** (production) or PAT (dev mode) | Yes for repo features |
| 3 | [Repository](#3-repository) owner / repo / branch | Recommended |
| 4 | [Integrations](#4-integrations-slack--jira--confluence--notion--google-docs--teams) | Optional — Trace Decision, Knowledge Gaps |

Production checklist: [connect-integrations-production.md](./connect-integrations-production.md).

---

## 1. Coop API

**Settings section:** API connection

| Field | Value |
|-------|-------|
| CoopAI API key | Bearer token from your Coop operator |
| API base URL | Default `https://api.coop-ai.dev`; use `http://localhost:8787` for local dev |

**Local dev:** any value works (e.g. `dev`) if the server has no token configured.

**Test:** **Test connection** → calls `GET /health`.

---

## 2. Code hosts (GitHub / GitLab / Bitbucket)

**Settings section:** Connections → GitHub / GitLab / Bitbucket

### GitHub (production)

**Connect GitHub** in the browser — tokens stored on the Coop server. See [github-connect.md](./github-connect.md) and [connect-integrations-production.md](./connect-integrations-production.md).

### GitHub (developer mode only)

| Field | Token type |
|-------|------------|
| GitHub token | Personal Access Token (`ghp_…` or fine-grained) |

**Suggested scopes:** `repo`, `read:org` (for private repos and org access).

**Test:** **Test GitHub**

### GitLab

| Field | Token type |
|-------|------------|
| GitLab token | Personal Access Token (`glpat-…`) |
| GitLab API base URL | `https://gitlab.com/api/v4` or self-hosted URL |

**Suggested scopes:** `read_api`, `read_repository`.

**Test:** **Test GitLab**

### Bitbucket

| Field | Token type |
|-------|------------|
| Bitbucket username | Atlassian account username |
| App password | Bitbucket app password (not account password) |

**Suggested permissions:** Repositories — Read; Pull requests — Read.

**Test:** **Test Bitbucket**

---

## 3. Repository

**Settings section:** Repository

Set default **owner**, **repo**, and **branch** for Trace Decision and context features. No secrets here.

---

## 4. Integrations (Slack / Jira / Confluence / Notion / Google Docs / Teams)

**Settings section:** Connections → Tools

Used by **Trace Decision**, **Knowledge Gaps**, and chat (`/slack`, `/jira`, `/confluence`, `/notion`, `/docs`, `/teams`).

### Production (`coopAI.devMode: false`)

Org admin: **Connect {tool}** → approve in browser → **Refresh status** → **Test**.

Server operator must register OAuth apps once — see [enterprise-integration-onboarding.md](./enterprise-integration-onboarding.md).

| Tool | Production Connect |
|------|---------------------|
| Slack | Yes |
| Jira + Confluence | Yes (one Atlassian OAuth) |
| Notion | Yes |
| Google Docs | Yes |
| Microsoft Teams | **Coming soon** (UI); backend OAuth wired |

### Slack (developer mode only)

**Token type:** User OAuth Token (`xoxp-…`) — **not** the bot token (`xoxb-…`).

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → your app (or create one).
2. **OAuth & Permissions** → **User Token Scopes** → add:
   - `search:read`
   - `channels:history`
   - `groups:history`
   - `users:read`
   - `channels:read`
3. **Reinstall to Workspace** (top of OAuth page).
4. Copy **User OAuth Token** (`xoxp-…`) from the same page.
5. **Settings → Slack** → paste token → **Save** → **Test Slack**.

#### Demo workspace note

The `scripts/populate_slack.py` seeder uses a **bot token** to post demo threads. Coop AI reads them with a **user token** from an account that can access `#epd`.

---

### Jira (developer mode only)

| Field | Value |
|-------|-------|
| Jira site URL | `https://your-domain.atlassian.net` |
| Jira account email | Atlassian account email |
| Jira API token | From [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |

**Test:** **Test Jira**

Production: use **Connect** on the Jira row (same Atlassian OAuth as Confluence).

#### Demo tickets

`scripts/populate_jira.py` creates **COOP-101**, **COOP-118**, etc. to match keys in `populate_slack.py`. Use a **fresh** `COOP` project (or accept key mismatch on an existing board).

```bash
cd scripts && cp .env.example .env   # set JIRA_*
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python populate_jira.py --dry-run
.venv/bin/python populate_jira.py
```

Set `JIRA_DEMO_GITHUB_OWNER` to your GitHub org so ticket descriptions list `github:your-org/coop-ai-core` repos you trace in the extension.

---

### Confluence (developer mode only)

| Field | Value |
|-------|-------|
| Confluence site URL | `https://your-domain.atlassian.net/wiki` |
| Confluence account email | Same Atlassian account email as Jira |
| Confluence API token | Same [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) as Jira |

**Test:** **Test Confluence**

Production: use **Connect** on the Confluence row (shared Atlassian OAuth).

#### Demo pages

`scripts/populate_confluence.py` creates architecture, onboarding, and ADR pages in a **COOP** space. Page bodies include `github:owner/repo` references so Coop's CQL search finds them.

```bash
cd scripts && cp .env.example .env   # set CONFLUENCE_* (or reuse JIRA_*)
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python populate_confluence.py --dry-run
.venv/bin/python populate_confluence.py
```

Set `CONFLUENCE_DEMO_GITHUB_OWNER` (or `JIRA_DEMO_GITHUB_OWNER`) to match **Settings → Repository → owner**, and use a repo name that appears in the seeded pages (default suffix `coop-ai-core`) or edit the script's `repos` fields.

**In chat:** `/confluence` or ask *"any confluence pages for this repo?"* after connecting credentials.

> **Note:** Understand Repo today uses GitHub context only; Confluence is optional for **Knowledge Gaps** and explicit `/confluence` queries. The seeder supports testing those integration paths.

---

### Notion (developer mode only)

| Field | Value |
|-------|-------|
| Notion integration token | `secret_…` from a Notion integration |

Production: **Connect Notion** (OAuth). Developer mode: paste token manually.

### Google Docs (developer mode only)

| Field | Value |
|-------|-------|
| Google Drive access token | OAuth token with `drive.readonly` |

Production: **Connect Google Docs** (OAuth). Developer mode: paste token manually.

### Microsoft Teams

**Coming soon** in Settings UI. Backend OAuth is implemented; production Connect not exposed yet.

Developer mode (legacy): paste a Microsoft Graph access token manually.

---

## 5. Model (LLM keys on server)

**Settings section:** Model

Provider and model are selected in the UI. **LLM API keys are not entered in the extension** — they are configured on the Coop server by your administrator.

**Non-technical setup guide:** [llm-provider-keys.md](./llm-provider-keys.md) — step-by-step instructions to register Anthropic, OpenAI, Gemini, or DeepSeek and hand keys to your operator.

**In the extension:** open **Model**, choose **LLM provider** and **Model**, keep **Enable live LLM chat** on, then try chat after your admin confirms keys are installed.

---

## 6. Server operator (self-hosted / backend)

Not configured in the extension UI. See:

| Doc | Covers |
|-----|--------|
| [enterprise-integration-onboarding.md](./enterprise-integration-onboarding.md) | Operator vs org admin vs developer; rollout phases |
| [connect-integrations-production.md](./connect-integrations-production.md) | Org admin Connect checklist + redirect URIs |
| [github-connect.md](./github-connect.md) | GitHub App vs OAuth App |
| [api-v1.md](./api-v1.md) | Coop API auth (`COOP_API_TOKEN`) |
| [webhook-backend.md](./webhook-backend.md) | GitHub/GitLab/Slack inbound webhooks |
| [job-queue.md](./job-queue.md) | Jobs API, Postgres, Redis |
| [llm-provider-keys.md](./llm-provider-keys.md) | Register LLM providers (plain-language guide) |
| [zero-retention-llm.md](./zero-retention-llm.md) | LLM env vars, BYOK |

### LLM provider env vars (server)

| Provider | Env var |
|----------|---------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Gemini | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |

### Webhook secrets (server)

| Provider | Env var |
|----------|---------|
| GitHub | `GITHUB_WEBHOOK_SECRET` |
| GitLab | `GITLAB_WEBHOOK_TOKEN` |
| Slack Events | `SLACK_SIGNING_SECRET` |

---

## Onboarding gaps (future work)

Tracked in [enterprise-integration-onboarding.md](./enterprise-integration-onboarding.md#honest-gap-analysis-product--docs):

- No first-run setup wizard in the extension
- Teams Connect UI coming soon
- Operator validation CLI / health panel for all OAuth apps
- In-app scope documentation on Connect cards
- License key has no settings field (`coopAI.licenseKey` in code only)
- Lightning Mode private-repo clone does not use saved code-host PATs

---

## Secret reference (extension)

| SecretStorage key | Integration |
|-------------------|-------------|
| `coopAI.apiToken` | Coop API |
| `coop.github.token` | GitHub |
| `coop.gitlab.token` | GitLab |
| `coop.bitbucket.username` / `coop.bitbucket.appPassword` | Bitbucket |
| `coop.slack.token` | Slack |
| `coop.jira.email` / `coop.jira.token` / `coop.jira.baseUrl` | Jira |
| `coop.teams.token` | Teams |
