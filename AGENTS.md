# Agent guide — Coop AI repo

## Canonical URLs

All production URLs use the **`coop-ai.dev`** domain (with hyphen).

| Purpose | URL | Config |
|---------|-----|--------|
| Marketing site | https://coop-ai.dev | `website/src/lib/site.config.ts`, `src/config/siteConfig.ts` |
| Pricing | https://coop-ai.dev/pricing | `PRICING_PAGE_URL` in `src/config/siteConfig.ts` |
| API (backend) | https://api.coop-ai.dev | `DEFAULT_API_BASE` in `src/chat/types.ts` |
| Admin portal | https://admin.coop-ai.dev | `admin/src/lib/coopApi.ts`, `COOP_ADMIN_PORTAL_URL` |

`www.coop-ai.dev` redirects to the apex domain (see `website/vercel.json`).

## VS Code extension webview UI

When adding or changing UI under `src/webview/`, follow the design policy in:

- **Rule:** `.cursor/rules/webview-ui.mdc` (applies when editing webview files)
- **Tokens & components:** `src/webview/globals.css` (`coop-*` classes)

Use existing patterns (`coop-prompt-modal`, `coop-settings-card`, `coop-quick-action-pill`, etc.). Avoid legacy patterns: full-screen black overlays, nested VS Code `inputValidation-*` boxes, inline `vscode-button-*` styles, and duplicate marketing copy in headers + body.

**Reference:** `PromptLibraryModal.tsx`, `SettingsPanel.tsx`, `LightningModePanel.tsx`.

## Other areas

- Marketing site: `website/` (separate Tailwind stack; not shared with the extension webview)
- Backend/docs: `docs/`
- Enterprise integration onboarding: `docs/enterprise-integration-onboarding.md` (operator vs org admin vs developer)
- Production Connect checklist: `docs/connect-integrations-production.md`
- API deploy (Railway): `docs/deploy-railway.md`

## Agent → user instructions

When giving setup, env, or test steps (not code review), follow:

- **`.cursor/rules/user-instructions.mdc`** — which surface (file, terminal, extension UI, browser); add vs change config; similar env vars
- **`.cursor/rules/clear-user-requests.mdc`** — lead with required vs optional; one happy path; where secrets come from; don't bury the ask

## Cursor Cloud specific instructions

This is a 3-package npm layout: root (VS Code extension + backend API + workers), `admin/`, and `website/`. Node 22 is required. The startup update script runs `npm ci` in all three directories, so dependencies are already installed when a session begins. Standard commands live in `package.json` scripts (root), `admin/package.json`, `website/package.json`; the `.env.*.example` files document env vars. Notes below are the non-obvious bits.

### Postgres (required for the backend)
- Postgres 16 + `pgvector` are installed at the system level (not via the update script). The cluster does **not** auto-start on a fresh VM — start it with `sudo pg_ctlcluster 16 main start`.
- The `coop` role (password `coop`, superuser) and `coopai` database already exist in the cluster data dir. If missing, recreate: `sudo -u postgres psql -c "CREATE ROLE coop LOGIN PASSWORD 'coop' SUPERUSER"` then `sudo -u postgres createdb -O coop coopai`.
- Connection string: `postgres://coop:coop@localhost:5432/coopai`.
- Apply migrations (idempotent ledger): `DATABASE_URL=postgres://coop:coop@localhost:5432/coopai npm run migrate`. Migration `008` needs the `pgvector` extension (handled by the `postgresql-16-pgvector` package).

### Backend API server (port 8787)
- Does **not** load `.env.backend` automatically — pass env vars inline. Build first (`npm run build:backend`), then run `node dist/webhookServer.js`.
- Useful dev env for testing without real LLM keys: `COOP_LLM_MOCK=true` (mock streamed responses), `COOP_REQUIRE_API_AUTH=false` (no-auth requests resolve to the `dev`/`free` org), `JOBS_BACKEND=postgres GRAPH_CACHE_BACKEND=memory JOBS_WORKERS=0`, plus `DATABASE_URL` and any non-empty `CREDENTIALS_ENCRYPTION_KEY`.
- Health: `GET /health`. Smoke the core chat path: `POST /v1/chat` with `{"message":"..."}` (Server-Sent-Events stream).

### Admin (3001) and website (3000/3002)
- Both dev scripts hardcode `-p 3001` (`next dev`). Run only one on 3001; override the other, e.g. website with `npm run dev -- -p 3002`.
- Local env goes in gitignored `admin/.env.local` / `website/.env.local`; point `*_COOP_API_BASE` at `http://localhost:8787`.

### Tests / lint
- Lint: root `npm run lint` (three `tsc --noEmit` projects). CI test list is in `.github/workflows/ci.yml`.
- Gotcha: `npm run test:indexing-progress` (and the `test:estate-indexing` aggregate that includes it) fails from the repo root because the test imports the `@/` path alias, which only resolves under `admin/`. Run it as `cd admin && npx tsx src/lib/indexingProgress.test.ts`. All other `test:*` scripts run fine from root.

