# Enterprise integration onboarding

**Updated:** July 9, 2026

How Coop AI integrations work in **production** (`coopAI.devMode: false`), who does what, and how to avoid the multi-day vendor-console setup you hit in local dev.

**Audience:** Coop platform operators, customer org admins, and sales/solutions engineers.

**Related:** [integration-onboarding.md](./integration-onboarding.md) (extension UI reference), [github-connect.md](./github-connect.md) (GitHub detail), [Single Sign On (SSO)](../website/content/docs/sso.md) (Enterprise IdP setup), [sso-smoke-test.md](./sso-smoke-test.md) (operator SSO validation).

---

## The enterprise model (three roles)

| Role | Does what | Frequency | Touches vendor consoles? |
|------|-----------|-----------|--------------------------|
| **Coop platform operator** | Runs `api.coop-ai.dev`, registers OAuth apps *once*, sets `.env.backend` on the server | Once per Coop deployment | Yes — but **not** your customers |
| **Customer org admin** | Signs in to [admin portal](https://admin.coop-ai.dev), connects integrations org-wide (GitHub App install, Slack, etc.) | Once per org per tool | No — browser OAuth / install only |
| **Developer** | Installs extension, signs in (email/password, Google, or org SSO), sets default repo | Once per machine | No |

**Enterprise-grade behavior today:** org OAuth tokens are stored **encrypted in Postgres** on the Coop server (`org_integration_connections`). Developers never paste Slack/Notion/Google tokens in production mode.

**What made local dev painful:** one person played **all three roles** — creating OAuth apps, editing `.env.backend`, seeding demo data, and clicking Connect — without a pre-provisioned platform.

---

## Target end-user experience (self-serve)

After the platform operator has configured the server, a **customer org admin** should complete onboarding in ~15 minutes:

1. **Browser** — [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login) → sign in (email/password, Google, or SSO)
2. **Browser** — **Integrations** → connect each tool (see GitHub handoff below)
3. **Browser** — **Indexing** → enable Deep-Index on company repos (Pro/Enterprise)
4. **Browser** — **Users** → invite teammates
5. **Extension UI** — Developers sign in → **Workspace** → pick repos → validate chat/quick actions

No `.env.backend`, no Docker, no Slack/Google/Azure developer portals for the customer.

---

## Platform operator setup (one-time per deployment)

### Prerequisites

| Requirement | Notes |
|-------------|--------|
| Coop API running | `https://api.coop-ai.dev` (or self-hosted) with Postgres |
| `CREDENTIALS_ENCRYPTION_KEY` | Long random secret in server env — **required** for org token storage |
| `WEBHOOK_DOMAIN` / `COOP_PUBLIC_BASE_URL` | Operator-only public HTTPS base for OAuth/SAML callbacks (e.g. `https://api.coop-ai.dev`) — not configured by org admins |
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
| Teams | `TEAMS_APP_CLIENT_ID`, `TEAMS_APP_CLIENT_SECRET` | Azure App registration — see [teams-connect.md](./teams-connect.md) |
| LLM | `ANTHROPIC_API_KEY`, etc. | Provider consoles — see [llm-provider-keys.md](./llm-provider-keys.md) |

After any env change: **Terminal** (on the server host):

```bash
docker compose up -d --build api
```

**Success:** `curl -s https://api.coop-ai.dev/health` returns `"ok":true`.

### Enterprise SAML SSO (operator)

For Enterprise orgs that sign in with SAML instead of password/Google:

| Task | Doc / tool |
|------|------------|
| IdP values, admin self-serve UI | [Single Sign On (SSO)](../website/content/docs/sso.md) — admin portal **Settings → Single sign-on** (`/settings/single-sign-on`) |
| Local/demo validation (seed org + SAML start redirect) | [sso-smoke-test.md](./sso-smoke-test.md) — `npm run smoke:sso` |
| Support-led IdP config | `scripts/admin-org.ts configure-sso` |
| API contract | `GET`/`PUT /v1/sso/config` (org admin bearer only); `GET`/`PUT /v1/sso/policy` |

**Shipped behavior:** Nested settings hub; self-serve IdP config + **Test sign-in** + sign-in policy; extension **Sign in with SSO** handoff. **`sso_required_active`** guard blocks disabling SAML while **Require SSO** is on.

**Known limits today:** SP-initiated login only; no SCIM; no SAML refresh tokens (12 h session TTL); shared Coop service provider across tenants (org resolved via RelayState).

**Operator env:** Set `COOP_PUBLIC_BASE_URL` to the API’s public URL — SAML SP Entity ID and ACS URL derive from it.

---

## Per-integration operator notes (condensed)

### GitHub

- **Production (all plans):** GitHub **App** (org-wide install). Setup URL = callback above. OAuth remains available as **Limited connect (OAuth)** when `GITHUB_OAUTH_*` is configured.
- **Customer admin:** Admin portal → **Integrations** → **Connect (GitHub App)** or **Send link to GitHub admin** (if IT owns the GitHub org) → **Refresh** → **Test GitHub**. Detail: [github-connect.md](./github-connect.md), test flow: [github-org-testing.md](./github-org-testing.md).

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
- Scopes: `read:jira-work`, `read:confluence-content.all`, `read:confluence-space.summary`, `read:space:confluence`, `search:confluence`, `offline_access`, etc. (see `atlassianAppService.ts`).
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

- **Entra app registration** (Microsoft Graph OAuth) — not a Teams Store manifest. Full steps: [teams-connect.md](./teams-connect.md).
- Delegated Graph permissions: `User.Read`, `Team.ReadBasic.All`, `ChannelMessage.Read.All`, `offline_access`.
- Redirect URI = `/v1/teams/app/callback`.
- Requires work/school Microsoft 365 with Teams channels (personal Teams/Community is not sufficient).
- **Customer admin:** **Connect Microsoft Teams** → approve (admin consent if required) → **Test Teams**.

---

## Customer org admin guide (self-serve)

Give this checklist to the customer's **owner/admin** user (`canInstallIntegrations: true`).

### 1. Sign in

**Browser** — [admin.coop-ai.dev/login](https://admin.coop-ai.dev/login)

- Email/password, **Continue with Google**, or **Sign in with SSO** (Enterprise)
- Developers invited by email use the link in the invite email → `/accept-invite?token=…`

**Enterprise SAML setup (org admin):** **Settings** → **Single sign-on** (`/settings/single-sign-on`) — configure IdP, **Test sign-in**, then optionally **Require SSO**. See [Single Sign On (SSO)](../website/content/docs/sso.md).

**Extension UI** (optional for admins testing the extension): **Settings → Account** → same credentials → **Test connection**

**Forgot password?** Use [coop-ai.dev/forgot-password](https://coop-ai.dev/forgot-password) or the link on the login page.

Automation API keys (`coop_…`) are for CI and scripts only — not primary sign-in.

### 2. Connect tools

**Browser** — Admin portal → **Integrations**

For each row:

1. **Connect {name}** (GitHub: **Connect (GitHub App)** or **Send link to GitHub admin**)
2. **Browser** — approve in vendor console
3. Return to admin → **Refresh** → **Test {name}**

| Tool | Notes |
|------|--------|
| **GitHub** | Prefer GitHub App on company org; **Limited connect (OAuth)** only if org owner cannot install the App |
| **Slack** | — |
| **Jira** | Set **Jira site URL** in extension Workspace if needed |
| **Confluence** | Set **Confluence site URL** (often `{site}/wiki`) |
| **Notion / Google Docs** | — |
| **Teams** | Work/school M365 required; admin consent may be needed — see [teams-connect.md](./teams-connect.md) |

Admins can also connect from **Extension UI → Settings → Tools** when signed in as owner/admin — admin portal is recommended for GitHub org install and scope management.

### 3. Index repos (Pro / Enterprise)

**Browser** — **Indexing** → **Configure GitHub** → select company repos → **Deep-Index selected**

### 4. Invite team

**Browser** — **Users** → invite by email (includes repo grants when per-user access mode is on)

### 5. Default repository (developers)

**Extension UI** — **Settings → Workspace** — **Owner**, **repo**, **branch** for repo-scoped queries; Pro users pick up to 3 workspace repos from the admin’s index.

### 6. Validate

| Test | Where |
|------|--------|
| API + auth | Extension **Account** → Test connection, or admin dashboard loads |
| Each integration | Admin **Integrations** → **Test {name}** |
| Chat context | Extension: ask e.g. *any notion pages for this repo?* or run **Knowledge Gaps** |

---

## Developer guide (no integration setup)

Developers **do not** register OAuth apps or edit server env.

1. Install Coop AI from marketplace (or VSIX from org).
2. **Settings → Account** — sign in with work email and password, Google, or org SSO (issued by admin invite).
3. **Settings → Workspace** — set repo (or use workspace defaults from admin).
4. Use chat and quick actions.

If an integration shows **Not connected**, escalate to **org admin** — not a developer token paste in production.

---

## Honest gap analysis (product + docs)

What exists today vs what enterprise self-serve still needs:

| Area | Today | Target |
|------|--------|--------|
| Org OAuth + server token store | Shipped for GitHub, Slack, Atlassian, Notion, Google Docs, Teams | Per-org BYO OAuth client (enterprise IT) |
| Operator env setup | Manual `.env.backend` per deployment | Hosted Coop: pre-configured; self-hosted: single setup guide + validation script |
| Customer admin UX | Admin portal **Integrations** + onboarding wizard + GitHub handoff | First-run wizard with in-app deep links to vendor docs |
| Operator validation | Manual `curl` / extension test | `GET /health` + `GET /v1/.../install-url` smoke panel or CLI |
| Docs | `integration-onboarding.md` + this doc + connect quick ref | Per-provider connect guides in Settings UI (in-app links) |
| Google restricted scopes | Manual consent screen + test users | Published app or Google Workspace domain install |
| Demo / seed data | `scripts/populate_*.py` (Slack, Jira, Confluence) | Optional hosted demo tenant; not required for Connect |
| SSO | **Shipped** — nested settings at `/settings/single-sign-on`, extension handoff; see [Single Sign On (SSO)](../website/content/docs/sso.md) | IdP-initiated login, SCIM, per-tenant SP |
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

**Phase D — Polish**
- Operator script: `coop-cli integrations verify` hitting all install-url endpoints.
- Per-integration scope allowlists beyond Slack (Jira, Notion, Google Docs, Teams).

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
| Teams admin consent required | Customer Microsoft 365 admin — see [teams-connect.md](./teams-connect.md) |
