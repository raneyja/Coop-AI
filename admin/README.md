# Coop AI — Customer Admin Portal

Organization admin console for managing integrations, users, and API keys. Separate from the marketing site (`website/`) and the VS Code extension.

## Quick start

### 1. File — `admin/.env.local`

Create this file (copy from `.env.example`):

```bash
# Local backend (docker compose api service)
NEXT_PUBLIC_COOP_API_BASE=http://localhost:8787

# Production
# NEXT_PUBLIC_COOP_API_BASE=https://api.coop-ai.dev
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
2. Paste your organization admin API key (`coop_*`)
3. On success you are redirected to the dashboard

**Success looks like:** Dashboard shows your org name, plan badge, and integration status grid.

## Authentication (v1)

- API key is stored in **sessionStorage** (`coop_admin_api_token`) for the browser tab session
- Sign out clears session storage
- **Phase 2:** SSO cookie auth (no key paste) — not implemented yet

Login validates the key via `GET /v1/me` and requires `canInstallIntegrations: true` or role `owner` / `admin`.

## Pages

| Route | Purpose |
|-------|---------|
| `/login` | API key sign-in |
| `/` | Dashboard — org overview, integration grid, stats |
| `/integrations` | Connect GitHub, Slack, Jira/Confluence, Notion, Google Docs, Teams |
| `/users` | Invite and manage users (`/v1/admin/users/*`) |
| `/analytics` | Usage analytics — DAU, chat, quick actions, CSV export (`/v1/admin/analytics/*`) |
| `/api-keys` | Create and revoke org API keys (`/v1/admin/api-keys/*`) |
| `/billing` | Plan, seats, and Stripe billing portal (`/v1/admin/billing/*`) |
| `/audit` | Admin audit log (`/v1/admin/audit`) |
| `/settings` | Org info, SSO placeholder |

## API client

`src/lib/coopApi.ts` wraps all backend calls with Bearer auth.

Admin routes live at `/v1/admin/*` on the Coop API. If the API is unreachable or returns 404, the UI shows an **“API not available”** banner and falls back to per-provider installation endpoints (`/v1/orgs/{provider}/installation`).

**CORS:** The API must allow your portal origin. For local dev, `http://localhost:3001` is allowed by default. For production, set `COOP_CORS_ORIGINS=https://admin.coop-ai.dev` in `.env.backend` and restart the API.

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
