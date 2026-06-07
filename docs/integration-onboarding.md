# Integration onboarding

How to connect external tools to Coop AI. All extension credentials are stored in VS Code **SecretStorage** (never in workspace files).

Open settings: Coop AI sidebar → gear icon, or Command Palette → **Coop AI: Open Settings**.

---

## Quick start (minimum to use Coop AI)

| Step | What | Required? |
|------|------|-----------|
| 1 | [Coop API key](#1-coop-api) | Yes |
| 2 | [Code host token](#2-code-hosts-github--gitlab--bitbucket) (GitHub/GitLab/Bitbucket) | Yes for repo features |
| 3 | [Repository](#3-repository) owner / repo / branch | Recommended |
| 4 | [Slack / Jira / Teams](#4-decision-archaeology-slack--jira--teams) | Optional — Trace Decision |

---

## 1. Coop API

**Settings section:** API connection

| Field | Value |
|-------|-------|
| CoopAI API key | Bearer token from your Coop operator |
| API base URL | Default `https://api.coopai.dev`; use `http://localhost:8787` for local dev |

**Local dev:** any value works (e.g. `dev`) if the server has no token configured.

**Test:** **Test connection** → calls `GET /health`.

---

## 2. Code hosts (GitHub / GitLab / Bitbucket)

**Settings section:** Code hosts

### GitHub

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

## 4. Decision archaeology (Slack / Jira / Teams)

**Settings section:** Decision archaeology

Used by **Trace Decision** to pull Slack threads, Jira tickets, and Teams messages linked to PRs and issues.

### Slack

**Token type:** User OAuth Token (`xoxp-…`) — **not** the bot token (`xoxb-…`).

#### Create the token

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → your app (or create one).
2. **OAuth & Permissions** → **User Token Scopes** → add:
   - `search:read`
   - `channels:history`
   - `groups:history`
   - `users:read`
   - `channels:read`
3. **Reinstall to Workspace** (top of OAuth page).
4. Copy **User OAuth Token** (`xoxp-…`) from the same page.

#### Add to Coop AI

1. Open Coop AI **Settings** → **Decision archaeology**.
2. Paste token in **Slack token**.
3. **Save Slack token** → **Test Slack**.

Success message includes your workspace name.

#### Demo workspace note

The `scripts/populate_slack.py` seeder uses a **bot token** to post demo threads. Coop AI reads them with a **user token** from an account that can access `#epd`.

---

### Jira

| Field | Value |
|-------|-------|
| Jira site URL | `https://your-domain.atlassian.net` |
| Jira account email | Atlassian account email |
| Jira API token | From [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |

**Test:** **Test Jira**

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

### Confluence

| Field | Value |
|-------|-------|
| Confluence site URL | `https://your-domain.atlassian.net/wiki` |
| Confluence account email | Same Atlassian account email as Jira |
| Confluence API token | Same [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) as Jira |

**Test:** **Test Confluence**

Use a **classic API token** (not scoped) so the extension hits `https://your-domain.atlassian.net/wiki/rest/api` directly.

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

### Microsoft Teams

| Field | Value |
|-------|-------|
| Microsoft Teams (Graph) token | OAuth access token for Microsoft Graph |

**No OAuth flow in the extension today** — obtain a token via Azure AD / Graph Explorer and paste manually.

**Minimum permissions:** `User.Read`; for message search also `ChannelMessage.Read.All` or equivalent.

**Test:** **Test Teams**

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

- No first-run wizard or setup checklist in the extension
- Teams requires manual Graph token paste (no OAuth flow)
- GitHub/GitLab/Bitbucket scope docs not yet shown in UI
- License key has no settings field (`coopAI.licenseKey` in code only)
- Lightning Mode private-repo clone does not use saved code-host PATs
- Confluence / Notion / Google Docs appear in Settings → Integrations as **Coming soon** (degradation fallback plumbing only)

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
