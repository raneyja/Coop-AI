# Coop AI — Customer Admin Portal

Organization admin console for managing integrations, users, and API keys. Separate from the marketing site (`website/`) and the VS Code extension.

Production: [admin.coop-ai.dev](https://admin.coop-ai.dev)

## Quick start

### 1. File — `admin/.env.local`

Create this file (copy from `.env.example`):

```bash
# Local backend (docker compose api service)
NEXT_PUBLIC_COOP_API_BASE=http://localhost:8787
COOP_API_BASE=http://localhost:8787

# Production
# NEXT_PUBLIC_COOP_API_BASE=https://api.coop-ai.dev
# COOP_API_BASE=https://api.coop-ai.dev
```

### 2. Terminal — install and run

From the repo root:

```bash
cd admin
npm install
npm run dev
```

Open **http://localhost:3001** in your browser.

### 3. Browser — sign in

1. Go to `/login`
2. Sign in with email and password, or **Continue with Google**
3. **Enterprise SAML:** enter **Organization name**, then **Continue with SSO** (inline on the login page)

**Success looks like:** Dashboard shows your org name, plan badge, and integration status grid.

Automation API keys are created on **API Keys** for CI and scripts — not for portal sign-in.

## Authentication

- **Primary:** Email/password or Google OAuth via `/api/auth/login` and backend `/v1/auth/*`
- **Invites:** Email link → `/accept-invite?token=…` → Continue with Google (same email) or set password → signed in
- **Pro activate:** Checkout welcome → same accept-invite page with activate copy + Google or password
- **Session:** Access token in `sessionStorage` plus httpOnly `coop_session` cookie (set by Next.js API routes)
- **Refresh:** Refresh token in `sessionStorage`; sign out calls `/api/auth/logout`

Login requires `canInstallIntegrations: true` or role `owner` / `admin` for admin pages. **Members** (developer role) see a reduced nav: dashboard, integrations (read-only status), chat feed, personal usage, and settings.

## Pages

| Route | Who | Purpose |
|-------|-----|---------|
| `/login` | All | Email/password, Google, or SSO sign-in |
| `/forgot-password` | All | Request a password reset email |
| `/accept-invite` | Invited users | Accept invite, set password, complete profile |
| `/auth/callback` | All | OAuth / SSO return handler |
| `/` | All | Dashboard — admin overview or member welcome + workspace repos |
| `/integrations` | All | Connect GitHub, Slack, Jira/Confluence, Notion, Google Docs, Teams |
| `/indexing` | Admin | Repo catalog, Deep-Index enable/disable, estate sync |
| `/collections` | Pro/Ent admin | Repo groupings |
| `/users` | Admin | Invite and manage users; per-user repo grants |
| `/analytics` | Admin | Organization usage — DAU, chat, completions, CSV export |
| `/analytics/my` | All signed-in users | Personal usage analytics (overview, chat, completions) |
| `/my-usage` | — | Redirects to `/analytics/my` |
| `/my-activity` | Member | Personal audit log |
| `/feed` | All | Chat thread browser |
| `/api-keys` | Admin | Create and revoke org API keys |
| `/billing` | Admin | Plan, seats, and Stripe billing portal |
| `/audit` | Admin | Org admin audit log |
| `/settings` | All | Settings hub — links to nested pages below |
| `/settings/account` | All | Account, org info, sign-out |
| `/settings/repository-access` | Pro/Ent admin | Per-user vs all-indexed repo access mode |
| `/settings/single-sign-on` | Enterprise admin | SAML IdP config, **Test sign-in**, sign-in policy |

### GitHub connect (admin)

On **Integrations → GitHub**:

- **Connect (GitHub App)** — opens GitHub install on company org (requires org owner or handoff)
- **Send link to GitHub admin** — copy signed install URL for IT
- **Limited connect (OAuth)** — fallback when App install is not possible (server must have `GITHUB_OAUTH_*`)
- **Waiting for GitHub** — shown after Connect until callback completes; auto-relink if App already installed

Detail: [docs/github-connect.md](../docs/github-connect.md)

## API client

`src/lib/coopApi.ts` wraps backend calls with Bearer auth from the browser session.

Server routes under `src/app/api/auth/*` proxy sign-in to the Coop API using `COOP_API_BASE`.

Admin routes live at `/v1/admin/*` on the Coop API. If the API is unreachable or returns 404, the UI shows an **“API not available”** banner and falls back to per-provider installation endpoints (`/v1/orgs/{provider}/installation`).

**CORS:** The API must allow your portal origin. For local dev, `http://localhost:3001` is allowed by default. For production, set `COOP_CORS_ORIGINS=https://admin.coop-ai.dev` in `.env.backend` and restart the API.

## Seed commands (local Docker)

**Terminal** — repo root, API + Postgres running:

```bash
npm run seed:pro-onboarding      # Fresh Pro org for onboarding / GitHub connect tests
npm run seed:repo-access-demo    # Pro org with admin + dev + repo grants demo
```

See [docs/repo-access-smoke-test.md](../docs/repo-access-smoke-test.md) and [docs/github-org-testing.md](../docs/github-org-testing.md).

## Build

```bash
cd admin
npm run build
npm start
```

## Port

Dev server runs on **3001** (`npm run dev -p 3001`). This matches backend defaults in `src/server/billing/billingConfig.ts` (`COOP_ADMIN_PORTAL_URL` fallback) and `website/src/app/welcome/page.tsx` (`NEXT_PUBLIC_ADMIN_PORTAL_URL` fallback).

The marketing site (`website/`) also defaults to 3001 — run only one at a time locally, or change the port in the relevant `package.json`.

Production deploy guide: [deploy-self-serve-pro.md](../docs/deploy-self-serve-pro.md).
