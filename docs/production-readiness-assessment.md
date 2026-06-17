# Coop AI — Production Readiness Assessment

**Date:** June 10, 2026  
**Scope:** Full codebase audit across backend, extension, admin portal, marketing site, infrastructure, and competitive landscape.

**Interactive dashboard:** Open [coop-production-readiness.canvas.tsx](/Users/jonraney/.cursor/projects/Users-jonraney-Desktop-Coop-AI/canvases/coop-production-readiness.canvas.tsx) beside this chat for the visual summary with phased action items.

---

## Executive summary

Coop AI has moved well beyond prototype: the **core product is real** — a VS Code extension with chat, quick actions, org OAuth integrations, cloud code indexing, Stripe billing, an admin portal, and enterprise SAML. A single-instance deployment with a configured operator can demo end-to-end flows today.

**It is not production-ready for a public launch** without closing security defaults, operational gaps, and several integration polish items. Overall estimated readiness: **~55%** across all dimensions needed for a self-serve SaaS launch.

| Dimension | Readiness | Verdict |
|-----------|-----------|---------|
| Core extension + chat | ~78% | Strong MVP |
| Integrations (OAuth) | ~72% | Teams UI + Slack scopes block |
| Code indexing (Lightning) | ~70% | Works; plan-gating TODO |
| Backend API + auth | ~65% | Auth disabled in compose |
| Billing + self-serve Pro | ~62% | Code complete; env + tests missing |
| Admin portal | ~58% | Functional MVP; deploy + polish needed |
| Marketing funnel | ~55% | Pricing/signup exist; env gaps |
| CI/CD + tests | ~25% | No workflows; thin server coverage |
| Observability | ~20% | Console only |
| Enterprise SaaS polish | ~35% | No analytics, SCIM, seat enforcement |

---

## What you've built (real, not stubbed)

### Extension (VS Code)

- Sidebar chat with streaming LLM via `/v1/chat`
- Quick actions: Trace Decision, Find Owner, Blast Radius, Knowledge Gaps, Understand Repo
- Settings hub: Account, Connections, Workspace, Team, Preferences
- Org OAuth Connect flows (browser) for GitHub, GitLab, Bitbucket, Slack, Atlassian, Notion, Google Docs
- Cloud credential overlay in production mode (`coopAI.devMode: false`)
- Degradation matrix with health monitoring per integration
- Prompt library, identity directory, SSO sign-in (enterprise plan)
- Decision archaeology engine (GitHub + Slack/Jira/Teams context)

**Key files:** `src/extension.ts`, `src/chat/CoopChatSession.ts`, `src/webview/components/settings/SettingsDetailViews.tsx`, `src/degradation/fallbackMatrix.ts`

### Backend API

- Monolithic HTTP server: admin, billing, org, chat, integrations, SAML, jobs, webhooks
- Postgres-backed multi-tenancy: orgs, API keys (hashed), encrypted integration tokens
- 13 database migrations (jobs → billing)
- Stripe checkout + webhook provisioning for Pro tier
- OAuth install-url/callback/status for all major providers
- GitHub/GitLab/Slack webhook ingestion
- Enterprise SAML SSO
- Admin APIs: users, API keys, integrations, audit, billing portal
- Job queue with API + worker split; SCIP + Zoekt + embeddings indexing

**Key files:** `src/webhooks/webhookServer.ts`, `src/server/authMiddleware.ts`, `src/server/billing/`, `src/server/admin*.ts`

### Admin portal (Next.js)

- Login (API key + SSO tab), auth callback, dashboard, integrations, users, API keys, billing, audit, settings
- Real API client wired to `/v1/admin/*`

**Key files:** `admin/src/app/(admin)/*`, `admin/src/lib/coopApi.ts`

### Marketing website

- Pricing page, signup form, checkout proxy → Stripe, welcome page
- Deployed target: Vercel at `https://coop-ai.dev`

**Key files:** `website/src/app/pricing/page.tsx`, `website/src/app/signup/page.tsx`, `website/src/app/api/checkout/route.ts`

---

## Critical blockers (must fix before launch)

### 1. Security — API auth disabled in Docker

`docker-compose.yml` sets `COOP_REQUIRE_API_AUTH: "false"` while `NODE_ENV: production`. When auth is off, **any Bearer token** is accepted as a full Pro org (`authMiddleware.ts` lines 65–72).

**Fix:** Set `COOP_REQUIRE_API_AUTH=true` in production. Remove or gate the dev bearer bypass when `NODE_ENV=production`.

### 2. CORS — admin portal will fail in browser

Default CORS allows only `http://localhost:3001`. Production admin at `admin.coop-ai.dev` needs `COOP_CORS_ORIGINS` set.

### 3. Database migrations — no upgrade path

Migrations auto-apply only on **fresh** Postgres volumes via `docker-entrypoint-initdb.d`. Existing databases need manual `psql -f` for migrations 004–013. No migration runner script exists. Docs (`webhook-backend.md`) list only migrations 001–003.

### 4. Slack OAuth scope mismatch

Server requests scopes without `search:read` (`slackAppService.ts`). Docs and `SlackClient.searchMessages` require it. Production Connect likely fails for message search. Also: no Slack token refresh branch in `integrationApi.ts`; bot token discarded after OAuth.

### 5. Teams Connect UI disabled

Backend fully wired (`teamsAppApi.ts`, `CoopChatSession.ts` handlers). Settings UI shows "Coming soon" (`SettingsDetailViews.tsx`). Largest integration gap for enterprise buyers expecting Microsoft stack.

### 6. Zero CI/CD

No `.github/workflows`. No unified `npm test`. 31 test files exist; only 8 wired to npm scripts. Billing, webhooks, admin APIs, OAuth flows largely untested.

### 7. No observability

Console logging only. No Sentry, Datadog, OpenTelemetry, or structured logs. No Docker HEALTHCHECK. Job monitoring is in-process only.

### 8. Technical debt — 57 duplicate `* 2.*` files

Untracked macOS duplicates across `src/`, `migrations/`, `docs/`. Risk of drift and accidental imports.

---

## Partially complete (works but not launch-grade)

| Area | Status | Gap |
|------|--------|-----|
| Stripe billing | Checkout + webhook provisioning work | Seat count not enforced; no webhook idempotency; email defaults to mock; audit orgId bug on checkout |
| Admin portal | Most routes wired | SSO settings placeholder; audit pagination missing; `lastUsed` vs `lastUsedAt` field mismatch; README outdated |
| Website funnel | Signup → Stripe redirect works | No session verification on `/welcome`; env vars undocumented; port 3001 vs 3002 mismatch |
| Webhook registration | Inbound handlers work | `PlaceholderWebhookClient` — no auto-register with GitHub/GitLab |
| Integration search | Live API at chat time | No background indexing of Slack/Jira/Confluence/Notion (unlike Glean) |
| SAML SSO | Server implemented | Operator-configured only; no self-serve admin setup; replay protection disabled |
| Extension marketplace | Built via esbuild | Version `0.0.1`; not published |
| Inline autocomplete | Registered in extension | Server returns `501` |
| First-run wizard | Documented as Phase B | Not built |
| Self-host APIs | Routes exist | Return `501` |

---

## Integration status matrix

| Integration | OAuth | Search/index | Settings UI | Top gap |
|-------------|-------|--------------|-------------|---------|
| GitHub / GitLab / Bitbucket | Ready | SCIP + Zoekt indexed | Connect + Test | Outbound webhook auto-register stubbed |
| Slack | Scope gap | Live API only | Connect + Test | Missing `search:read`; no token refresh |
| Jira + Confluence | Ready | Live API only | Connect + manual site URL | Site URL not auto-filled from OAuth |
| Notion | Ready | Live API only | Connect + Test | None critical |
| Google Docs | Ready | Live API only | Connect + Test | Google consent screen for prod |
| Microsoft Teams | Backend ready | Live API only | **Coming soon** | UI disabled |

Architecture note: integration content (Slack messages, Jira tickets, Confluence pages) is fetched **on-demand at chat time**, not background-indexed. Code repos are the only indexed content (SCIP/Zoekt/embeddings).

---

## Market comparison

### Coop's positioning

**Wedge:** Developer-native AI in VS Code that connects **code ownership**, **decision archaeology**, and **live knowledge** from Slack/Jira/Confluence/Notion — not a separate search portal or dashboard.

### vs Sourcegraph Cody Enterprise

| | Sourcegraph | Coop AI |
|---|-------------|---------|
| Strength | Pre-indexed multi-repo code search; enterprise scale | Cross-tool context in IDE; quick actions (Trace Decision, Knowledge Gaps) |
| Pricing | Enterprise-only sales (~$75k median platform contract) | Self-serve Pro via Stripe (in progress) |
| Gap for Coop | — | No multi-repo @-mentions; smaller index scale; no admin analytics |

Cody Free/Pro were discontinued July 2025; Cody Enterprise remains the focus. Sourcegraph is investing in Amp for agentic workflows separately.

### vs Glean

| | Glean | Coop AI |
|---|-------|---------|
| Strength | Indexed crawls across 100+ apps; Slack RTS; permission-aware unified search | IDE-native; code graph + ownership; SCIP indexing; developer workflows |
| Gap for Coop | — | No background doc indexing; no Slack bot; no enterprise search portal |

Glean indexes Jira/Confluence with near-real-time sync and webhooks. Coop uses live API calls — faster to ship, weaker for broad search.

### vs Augment / Cursor-style assistants

| | Augment/Cursor | Coop AI |
|---|----------------|---------|
| Strength | Whole-codebase AI; strong autocomplete; self-serve ($20/mo+) | Org integrations; degradation matrix; enterprise SSO; decision workflows |
| Gap for Coop | — | No inline autocomplete (501); not marketplace-published |

### vs DX / Swarmia / LinearB

| | DX/Swarmia | Coop AI |
|---|------------|---------|
| Strength | Engineering metrics, ownership dashboards | AI chat + context synthesis in-editor |
| Gap for Coop | — | No usage analytics or team metrics in admin |

---

## Recommended action plan

### Phase 1 — Launch blockers (~1 week)

Do these before any public traffic:

1. **Security hardening**
   - `COOP_REQUIRE_API_AUTH=true` in prod compose/env
   - Strong `CREDENTIALS_ENCRYPTION_KEY` (not example placeholder)
   - Guard integration token handlers with `isCoopDevMode()` in `CoopChatSession.ts`

2. **Production config**
   - `COOP_CORS_ORIGINS` including `https://admin.coop-ai.dev`
   - `COOP_PUBLIC_BASE_URL=https://api.coop-ai.dev`
   - All OAuth app credentials in `.env.backend`
   - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO`
   - Email: `RESEND_API_KEY`, `COOP_EMAIL_MOCK=false`

3. **Database**
   - Apply migrations 004–013 on existing Postgres
   - Add migration runner script (e.g. `scripts/migrate.sh`)

4. **Slack fix**
   - Add `search:read` to OAuth scopes
   - Add Slack token refresh in `integrationApi.ts`

5. **Repo hygiene**
   - Delete or `.gitignore` all `* 2.*` duplicate files

6. **CI baseline**
   - GitHub Actions: `npm run lint` + all test scripts + Docker build smoke

### Phase 2 — Self-serve Pro MVP (~2 weeks)

1. Enable Teams Connect UI (remove "Coming soon"; wire existing handlers)
2. Deploy admin portal to `admin.coop-ai.dev`; fix port defaults (3001 vs 3002)
3. Wire website env: `COOP_API_BASE`, `NEXT_PUBLIC_ADMIN_PORTAL_URL`
4. Fix admin bugs: `lastUsed`/`lastUsedAt`, audit pagination, update README
5. Implement seat enforcement on user invites
6. Add Sentry or Datadog + Docker HEALTHCHECK on `/health`
7. Replace or document `PlaceholderWebhookClient`
8. Stripe dashboard: webhook endpoint + events configured

### Phase 3 — Enterprise + differentiation (~4+ weeks)

1. First-run onboarding wizard (Phase B in enterprise doc)
2. Publish VS Code extension to marketplace
3. Roadmap items: file @-mentions, inline autocomplete T0
4. Usage analytics in admin (Pro tier promise)
5. Self-serve SSO setup in admin settings
6. Redis-backed dedupe/rate limits for multi-instance HA
7. Billing tests + webhook idempotency + `invoice.payment_failed`
8. BYOK on router (enterprise pilot)

---

## What's intentionally deferred (roadmap)

From `docs/roadmap.md`:

- File @-mentions in chat
- Inline autocomplete T0/T1 (server returns 501 today)
- BYOK on ModelRouter
- Live graph context replacing placeholders in quick actions
- Real provider cutover checklist (leave mock mode)

---

## Environment checklist for production

### `.env.backend` (repo root — not committed)

| Variable | Required for | Notes |
|----------|--------------|-------|
| `CREDENTIALS_ENCRYPTION_KEY` | Token encryption | Must be long random secret |
| `COOP_REQUIRE_API_AUTH` | Security | Must be `true` |
| `COOP_CORS_ORIGINS` | Admin portal | Include admin + marketing origins |
| `COOP_PUBLIC_BASE_URL` | OAuth/SAML callbacks | `https://api.coop-ai.dev` |
| `STRIPE_*` | Pro billing | Secret, webhook secret, price ID |
| `RESEND_*` | Welcome emails | Set `COOP_EMAIL_MOCK=false` |
| OAuth vars per provider | Connect flows | See `.env.backend.example` |

### Website (Vercel)

| Variable | Value |
|----------|-------|
| `COOP_API_BASE` | `https://api.coop-ai.dev` |
| `NEXT_PUBLIC_ADMIN_PORTAL_URL` | `https://admin.coop-ai.dev` |

### Admin portal

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_COOP_API_BASE` | `https://api.coop-ai.dev` |

### Stripe dashboard

- Webhook: `https://api.coop-ai.dev/webhooks/stripe`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Test coverage snapshot

| Area | Test files | Gap |
|------|------------|-----|
| Prompts/context builders | ~15 | Good |
| Auth middleware | 1 | Minimal |
| Billing/Stripe | 0 | Critical |
| Webhook server | 0 | Critical |
| Admin APIs | 0 | Critical |
| OAuth flows | 2 partial | Critical |
| CoopChatSession | 0 | Critical |
| Indexing/Lightning | 0 | High |

---

## Honest verdict

**You are past the "is this real?" stage.** The architecture is coherent: extension → API → Postgres → integrations → indexing → billing → admin. A focused operator can run a pilot with one customer org today if they configure env vars, apply migrations, and accept single-instance limits.

**You are not at the "flip the switch for self-serve Pro" stage.** Security defaults, CI/CD, observability, Slack scopes, Teams UI, and admin deploy/config must close first. Budget **4–6 weeks** for a credible public Pro launch and **8–12 weeks** for enterprise-grade (SSO self-serve, analytics, HA, marketplace extension).

**Differentiation is clear:** no competitor ships Trace Decision + Knowledge Gaps + ownership graph + live Slack/Jira context inside VS Code with org OAuth. The gap vs Glean is indexing breadth; the gap vs Sourcegraph is code search scale; the gap vs Cursor is autocomplete polish. Your moat is **cross-tool developer workflows in-IDE** — protect that while closing ops gaps.

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [enterprise-integration-onboarding.md](./enterprise-integration-onboarding.md) | Three-role model, gap analysis, rollout phases |
| [connect-integrations-production.md](./connect-integrations-production.md) | 5-minute org admin Connect checklist |
| [integration-onboarding.md](./integration-onboarding.md) | Extension UI reference |
| [roadmap.md](./roadmap.md) | Deferred features |
| [webhook-backend.md](./webhook-backend.md) | Graph routes, webhooks, health |
| `.env.backend.example` | Full env template |
