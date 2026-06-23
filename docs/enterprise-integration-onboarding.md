# Enterprise integration onboarding

How Coop AI integrations work in **production** (`coopAI.devMode: false`), who does what, and how to avoid the multi-day vendor-console setup you hit in local dev.

**Audience:** Coop platform operators, customer org admins, and sales/solutions engineers.

**Related:** [integration-onboarding.md](./integration-onboarding.md) (extension UI reference), [github-connect.md](./github-connect.md) (GitHub detail).

---

## The enterprise model (three roles)

| Role | Does what | Frequency | Touches vendor consoles? |
|------|-----------|-----------|--------------------------|
| **Coop platform operator** | Runs `api.coop-ai.dev`, registers OAuth apps *once*, sets `.env.backend` on the server | Once per Coop deployment | Yes — but **not** your customers |
| **Customer org admin** | Signs in to Coop, clicks **Connect** per tool in VS Code Settings | Once per org per tool | No — browser OAuth only |
| **Developer** | Installs extension, signs in (SSO or org API key), sets default repo | Once per machine | No |

**Enterprise-grade behavior today:** org OAuth tokens are stored **encrypted in Postgres** on the Coop server (`org_integration_connections`). Developers never paste Slack/Notion/Google tokens in production mode.

**What made local dev painful:** one person played **all three roles** — creating OAuth apps, editing `.env.backend`, seeding demo data, and clicking Connect — without a pre-provisioned platform.

---

## Target end-user experience (self-serve)

After the platform operator has configured the server, a **customer org admin** should complete onboarding in ~15 minutes:

1. **Extension UI** — Install Coop AI → **Settings → Account** → sign in (SSO or org API key) → **Test connection**
2. **Extension UI** — **Settings → Tools** → for each tool: **Connect** → approve in browser → **Refresh status** → **Test**
3. **Extension UI** — **Settings → Workspace** → set default **owner / repo / branch**
4. **Extension UI** — run a quick action or chat query to validate context

No `.env.backend`, no Docker, no Slack/Google/Azure developer portals for the customer.

---

## Platform operator setup (one-time per deployment)

### Prerequisites

| Requirement | Notes |
|-------------|--------|
| Coop API running | `https://api.coop-ai.dev` (or self-hosted) with Postgres |
| `CREDENTIALS_ENCRYPTION_KEY` | Long random secret in server env — **required** for org token storage |
| `WEBHOOK_DOMAIN` / `COOP_PUBLIC_BASE_URL` | Public HTTPS base for OAuth callbacks (e.g. `https://api.coop-ai.dev`) |
| OAuth apps registered | One registration per provider below — owned by **Coop** or **customer IT**, not end developers |

### Master redirect URI pattern

All org OAuth integrations use the same host; only the path changes:

```
https://api.coop-ai.dev/v1/{provider}/app/callback
```

| Provider | Callback path |
|----------|----------------|
| GitHub (OAuth App) | `/v1/github/app/callback` |
| GitLab | `/v1/gitlab/app/callback` |
| Bitbucket | `/v1/bitbucket/app/callback` |
| Slack | `/v1/slack/app/callback` |
| Atlassian (Jira + Confluence) | `/v1/atlassian/app/callback` |
| Notion | `/v1/notion/app/callback` |
| Google Docs (Drive read) | `/v1/google-docs/app/callback` |
| Microsoft Teams | `/v1/teams/app/callback` |

Local dev replaces the host: `http://localhost:8787/v1/.../app/callback`.

### Server env vars (operator checklist)

Copy from [`.env.backend.example`](../.env.backend.example). **Never commit** live `.env.backend`.

| Integration | Env vars | Operator registers |
|-------------|----------|-------------------|
| GitHub (prod) | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG` | [GitHub App](https://github.com/settings/apps/new) — see [github-connect.md](./github-connect.md) |
| GitHub (dev/small team) | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App |
| Slack | `SLACK_APP_CLIENT_ID`, `SLACK_APP_CLIENT_SECRET` | [api.slack.com/apps](https://api.slack.com/apps) |
| Jira + Confluence | `ATLASSIAN_APP_CLIENT_ID`, `ATLASSIAN_APP_CLIENT_SECRET` | [developer.atlassian.com](https://developer.atlassian.com/console/myapps/) |
| Notion | `NOTION_APP_CLIENT_ID`, `NOTION_APP_CLIENT_SECRET` | [notion.so/my-integrations](https://www.notion.so/my-integrations) — **OAuth** connection type |
| Google Docs | `GOOGLE_DOCS_APP_CLIENT_ID`, `GOOGLE_DOCS_APP_CLIENT_SECRET` | Google Cloud OAuth client (Web) + Drive API + `drive.readonly` scope |
| Teams | `TEAMS_APP_CLIENT_ID`, `TEAMS_APP_CLIENT_SECRET` | Azure App registration — **coming soon** in product UI |
| LLM | `ANTHROPIC_API_KEY`, etc. | Provider consoles — see [llm-provider-keys.md](./llm-provider-keys.md) |

After any env change: **Terminal** (on the server host):

```bash
docker compose up -d --build api
```

**Success:** `curl -s https://api.coop-ai.dev/health` returns `"ok":true`.

---

## Per-integration operator notes (condensed)

### GitHub

- **Production:** GitHub **App** (org-wide install). Setup URL = callback above.
- **Customer admin:** **Connect GitHub** → install/authorize → **Test GitHub**.
- Detail: [github-connect.md](./github-connect.md).

### Slack

- Create Slack app → **OAuth & Permissions** → add scopes (must match `slackAppService.ts`):

  | Token type | Scopes |
  |------------|--------|
  | Bot | `channels:read`, `channels:history`, `users:read`, `users:read.email` |
  | User | `users:read`, `users:read.email` |

- Redirect URI = `/v1/slack/app/callback`.
- **Customer admin:** **Connect Slack** → pick workspace → **Test Slack**.

### Atlassian (Jira + Confluence)

- One Atlassian 3LO app covers **both** Jira and Confluence.
- Scopes: `read:jira-work`, `read:confluence-content.all`, `search:confluence`, `offline_access`, etc. (see `atlassianAppService.ts`).
- **Customer admin:** **Connect** from Jira or Confluence row (same OAuth) → set site URLs in Settings if needed → **Test**.

### Notion

- Connection type: **OAuth** (not Access token).
- Capability: **Read content** (minimum).
- Redirect URI = `/v1/notion/app/callback`.
- **Customer admin:** **Connect Notion** → select pages/workspace → **Test Notion**.

### Google Docs

- Google Cloud: enable **Drive API**, OAuth consent screen, add **`drive.readonly`** under restricted scopes.
- OAuth client type: **Web application**; redirect = `/v1/google-docs/app/callback`.
- Testing mode: add customer test users OR publish app for production.
- **Customer admin:** **Connect Google Docs** → approve Drive read → **Test Google Docs**.

### Microsoft Teams

- Backend OAuth is implemented; extension UI shows **Coming soon**.
- Operator runbook (when enabled): Azure app, delegated Graph permissions `User.Read`, `Team.ReadBasic.All`, `ChannelMessage.Read.All`.
- Requires work/school Teams with channels (personal Teams/Community is not sufficient for search).

---

## Customer org admin guide (self-serve)

Give this checklist to the customer's **owner/admin** user (`canInstallIntegrations: true`).

### 1. Sign in

**Extension UI** — **Settings → Account**

- SSO: **Sign in with SSO** (if configured), or
- API key: paste org key from Coop operator → **Save** → **Test connection**

### 2. Connect tools

**Extension UI** — **Settings → Tools**

For each row, same pattern:

1. **Connect {name}**
2. **Browser** — sign in to the vendor → approve access
3. Return to VS Code → **Refresh status** → **Test {name}**

| Tool | Admin also sets |
|------|-----------------|
| GitHub / GitLab / Bitbucket | — |
| Slack | — |
| Jira | **Jira site URL** on detail screen |
| Confluence | **Confluence site URL** (often `{site}/wiki`) |
| Notion | — |
| Google Docs | — |
| Teams | Coming soon |

### 3. Default repository

**Extension UI** — **Settings → Workspace**

- **Owner**, **repo**, **branch** — used for repo-scoped doc/search queries.

### 4. Validate

| Test | Extension UI action |
|------|---------------------|
| API + auth | **Account** → Test connection |
| Each integration | **Tools** → **Test {name}** |
| Chat context | Ask e.g. *any notion pages for this repo?* or run **Knowledge Gaps** |

---

## Developer guide (no integration setup)

Developers **do not** register OAuth apps or edit server env.

1. Install Coop AI from marketplace (or VSIX from org).
2. **Settings → Account** — sign in with org SSO or API key issued by admin.
3. **Settings → Workspace** — set repo (or use workspace defaults from admin).
4. Use chat and quick actions.

If an integration shows **Not connected**, escalate to **org admin** — not a developer token paste in production.

---

## Honest gap analysis (product + docs)

What exists today vs what enterprise self-serve still needs:

| Area | Today | Target |
|------|--------|--------|
| Org OAuth + server token store | Shipped for GitHub, Slack, Atlassian, Notion, Google Docs | Teams UI enablement |
| Operator env setup | Manual `.env.backend` per deployment | Hosted Coop: pre-configured; self-hosted: single setup guide + validation script |
| Customer admin UX | **Connect** + **Test** per integration | First-run **setup wizard** with checklist and deep links |
| Operator validation | Manual `curl` / extension test | `GET /health` + `GET /v1/.../install-url` smoke panel or CLI |
| Docs | `integration-onboarding.md` + this doc + connect quick ref | Per-provider connect guides in Settings UI (in-app links) |
| Google restricted scopes | Manual consent screen + test users | Published app or Google Workspace domain install |
| Demo / seed data | `scripts/populate_*.py` (Slack, Jira, Confluence) | Optional hosted demo tenant; not required for Connect |
| SSO | Supported server-side | Default enterprise sign-in path in extension |
| In-app scope help | Minimal | Show required scopes on each Connect card |

### Recommended rollout phases

**Phase A — Operator playbook (now)**  
- Coop registers all OAuth apps for `api.coop-ai.dev` once.  
- Document customer admin checklist (above).  
- Onboard new customer orgs with API key + “click Connect” session.

**Phase B — In-product onboarding (next)**  
- First-run wizard: Account → Tools checklist with green/red status.  
- Disable or hide PAT fields unless `coopAI.devMode: true`.  
- Link from each Connect card to admin-only setup doc.

**Phase C — Customer-owned apps (enterprise IT)**  
- Allow per-org OAuth client override (BYO OAuth app) for customers who cannot use Coop’s shared apps.  
- Document “bring your own client ID” for regulated industries.

**Phase D — Teams + polish**  
- Enable Teams Connect in UI when channel OAuth is validated on work tenants.  
- Operator script: `coop-cli integrations verify` hitting all install-url endpoints.

---

## Security summary (for security review)

| Data | Where it lives |
|------|----------------|
| Org OAuth access/refresh tokens | Postgres `org_integration_connections`, encrypted with `CREDENTIALS_ENCRYPTION_KEY` |
| LLM provider keys | Server env only |
| Coop org API keys | Hashed server-side; extension holds bearer token in VS Code SecretStorage |
| Developer PATs (GitHub, etc.) | **Dev mode only** — not the production path |

Revocation: customer removes app access in vendor console; org admin can re-connect in Coop to refresh tokens.

---

## Quick reference: who to call

| Symptom | Owner |
|---------|--------|
| “Slack is not configured on this server” | Coop platform operator (missing env vars) |
| “Only your organization admin can connect…” | Customer org admin / owner |
| Connect works but search returns nothing | Customer admin: repo settings + vendor content access |
| Google 403 insufficient scopes | Re-connect after operator added `drive.readonly`; revoke old grant |
| Teams Coming soon | Product — use Slack/Jira/Confluence/Notion/Docs for Trace Decision |
