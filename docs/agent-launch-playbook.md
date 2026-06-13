# Agent Launch Playbook — Build Everything Today

**Date:** June 10, 2026  
**Repo:** `/Users/jonraney/Desktop/Coop AI`

---

## Launch status (updated June 11, 2026)

**Phase:** Agent build + local smoke tests **complete**. Next phase is **operator production deploy** (not more feature agents).

| Track | Status | Notes |
|-------|--------|-------|
| **P1** Phase 1 blockers | ✅ Done | Merged PR #3; CI merged PR #4 (green on `main`) |
| **D** Telemetry + seats | ✅ Done | `usage_events`, seat limit, analytics API |
| **C** Autocomplete T0 | ✅ Done | Toggle bug fixed; inline route works |
| **A** @ picker + collections | ✅ Done | Smoke A1 passed (Platform Team collection) |
| **B** Admin analytics UI | ✅ Done | Smoke B passed; Completions tab wired |
| **P2** Deploy docs + env polish | ✅ Done (code/docs) | `docs/deploy-self-serve-pro.md` |
| **Smoke tests A1–D** | ✅ Passed | Local Test Org `3f05b1e2-…` |
| **Git** | ✅ Clean | `main` @ merge PR #4; feature branches deleted |
| **Operator deploy** | ⏳ **In progress** | API: [deploy-railway.md](./deploy-railway.md); then Stripe/Resend/admin |
| **Extension publish** | ⏳ Later | VSIX / Marketplace — outside today's playbook |

**Do next:** [Operator checklist](#operator-checklist-you--not-agents) below + [deploy-self-serve-pro.md](./deploy-self-serve-pro.md).

---

Open **one new Cursor Agent chat per agent** below. Paste the full prompt block for that agent. Agents should run autonomously — implement, test, and report completion with verification steps.

**Coordination docs:**
- [feature-gap-handoff.md](./feature-gap-handoff.md) — feature specs
- [production-readiness-assessment.md](./production-readiness-assessment.md) — full audit
- [coop-production-readiness.canvas.tsx](/Users/jonraney/.cursor/projects/Users-jonraney-Desktop-Coop-AI/canvases/coop-production-readiness.canvas.tsx) — phase checklist

---

## Launch order (today)

```text
T+0 min   Agent P1  (Phase 1)     START FIRST — unblocks all others
T+60 min  Agent D   (telemetry)    Start after P1 migration runner exists
T+60 min  Agent C   (autocomplete) Start after P1 API rebuild (parallel with D)
T+90 min  Agent A   (@ + collections) Start after P1 (parallel with D/C)
T+120 min Agent B   (analytics UI)  Start after D creates usage_events + API stubs
T+180 min Agent P2  (self-serve)    Start after P1; needs Stripe/Resend from operator
```

**Operator actions (you, not agents):** Create Stripe account + product price, Resend API key, deploy targets. Agents wire code; you paste secrets into `.env.backend` and Vercel.

---

## Global rules (every agent)

1. **Repo root:** `/Users/jonraney/Desktop/Coop AI`
2. **Follow:** `AGENTS.md`, `.cursor/rules/webview-ui.mdc` for webview files
3. **Do not commit** unless the user asks in that chat
4. **Do not read or commit** `.env.backend` — use `.env.backend.example` for templates
5. **Delete untracked `* 2.*` duplicate files** only in Agent P1 (avoid conflicts)
6. **Minimize scope** — no drive-by refactors
7. **Run verification** at end: `npm run lint`, relevant tests, docker smoke where applicable
8. **Report:** files changed, how to verify, blockers for other agents

---

## Agent P1 — Phase 1 Launch Blockers

**Priority:** START FIRST  
**Owns:** security, migrations, CI, repo hygiene, docker-compose auth  
**Do not touch:** admin analytics UI, @ picker UI, usage_events schema (Agent D)

### Copy-paste into new chat

```
You are Agent P1 — Coop AI Phase 1 launch blockers.

Repo: /Users/jonraney/Desktop/Coop AI

Read first:
- docs/production-readiness-assessment.md (Phase 1 section)
- docker-compose.yml
- src/server/authMiddleware.ts
- src/server/serverConfig.ts
- migrations/*.sql

Implement ALL items below in order. Run autonomously. Do not commit unless asked.

## 1. Security hardening
- Remove COOP_REQUIRE_API_AUTH: "false" override from docker-compose.yml api/worker (let .env.backend control it; document that prod must set true)
- In authMiddleware.ts: when NODE_ENV=production AND requireApiAuth, reject the legacy-dev bearer bypass (any token → pro)
- Guard integration token handlers in CoopChatSession.ts with isCoopDevMode() — match code-host PAT pattern (lines ~843-928)

## 2. Production config template
- Update .env.backend.example: COOP_REQUIRE_API_AUTH=true for production comment block; ensure COOP_CORS_ORIGINS example includes admin origins

## 3. Migration runner
- Create scripts/migrate.sh (or migrate.ts) that applies migrations 001-013 in order on existing Postgres, tracking applied migrations in schema_migrations table
- Document in docs/webhook-backend.md how to run on existing DBs

## 4. Slack OAuth scopes
- Add search:read (and any scopes needed for search.messages) to slackAppService.ts
- Add Slack token refresh branch in integrationApi.ts resolveAccessToken

## 5. CI baseline
- Create .github/workflows/ci.yml: checkout, npm ci, npm run lint, run all test:* scripts from package.json, docker build smoke test

## 6. Repo hygiene
- Delete all untracked files matching * 2.* (macOS duplicates) under src/, migrations/, docs/, scripts/
- Add pattern to .gitignore to prevent recurrence: * 2.*

## 7. Docker health
- Add HEALTHCHECK to Dockerfile or docker-compose for api: curl -f http://localhost:8787/health

## Verification (run and report output)
- npm run lint
- All npm run test:* scripts that exist
- docker compose up -d --build api && curl -s http://localhost:8787/health | head
- ./scripts/migrate.sh against local postgres (or document dry-run)

Report: checklist of done items, any failures, what Agents D/C/A can now start.
```

---

## Agent D — Usage Telemetry + Seat Enforcement

**Start after:** P1 migration runner exists  
**Owns:** `014_usage_events.sql`, UsageTracker, seat checks, instrumentation, `POST /v1/usage/events`  
**Do not touch:** admin analytics UI pages (Agent B)

### Copy-paste into new chat

```
You are Agent D — Coop AI usage telemetry + seat enforcement.

Repo: /Users/jonraney/Desktop/Coop AI

Read first:
- docs/feature-gap-handoff.md § Thread D
- src/server/adminUsersApi.ts
- src/server/orgStore.ts
- src/server/billing/billingApi.ts
- src/server/audit/auditLogger.ts
- migrations/013_org_billing.sql

Prerequisite: migrations 001-013 apply cleanly (Agent P1). Create 014 as next migration.

Implement ALL below. Run autonomously. Do not commit unless asked.

## D1 — Migration 014_usage_events.sql
CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  user_id TEXT,
  principal TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
Indexes on (org_id, created_at DESC) and (org_id, event_type, created_at DESC).

## D2 — UsageTracker
- src/server/usageTracker.ts — record({ orgId, userId, principal, eventType, metadata })
- Fail-open on write errors (like audit logger)

## D3 — Seat enforcement
- adminUsersApi.ts invite: count active users; if >= org.seatCount return 403 { error: "seat_limit_reached", seats, used }
- billingApi.ts handleSubscriptionChange: sync seat_count from Stripe subscription quantity when present
- admin users page: show "X of Y seats used"

## D4 — Instrumentation (emit usage_events)
- chatApi.ts after successful chat: event_type chat.message (+ token metadata if available)
- lightningSearch.ts or graph search route: lightning.search
- inlineCompletionApi.ts: completion.suggested (or rely on audit + query)
- CoopChatSession quick action handlers: quick_action.{trace_decision,find_owner,blast_radius,knowledge_gaps,repo_summary}

## D5 — Extension batch endpoint
- POST /v1/usage/events — accept array of { eventType, metadata }
- Auth required; register in webhookServer routing
- Wire from autocomplete accept/reject when Agent C lands (leave TODO comment if C parallel)

## D6 — Admin analytics API stubs (for Agent B)
- GET /v1/admin/analytics/overview?from=&to= — DAU, total events, seat utilization
- GET /v1/admin/analytics/chat?from=&to=
- GET /v1/admin/analytics/export.csv?from=&to=
- src/server/adminAnalyticsApi.ts + register in adminApi.ts
- Gate: requireOrgAdmin

## Verification
- Unit/integration test for seat limit on invite
- Test usage_events insert
- curl admin analytics overview with admin API key

Report: migration file, API routes, seat enforcement behavior, message for Agent B to build UI.
```

---

## Agent C — Autocomplete T0 Ship

**Start after:** P1 API rebuild  
**Parallel with:** D, A  
**Owns:** `src/autocomplete/`, inline tests, docs fixes  
**Do not touch:** usage_events (Agent D), @ picker (Agent A)

### Copy-paste into new chat

```
You are Agent C — Coop AI autocomplete T0 ship.

Repo: /Users/jonraney/Desktop/Coop AI

Read first:
- docs/feature-gap-handoff.md § Thread C
- docs/roadmap.md §2
- src/autocomplete/coopAutocompleteProvider.ts
- src/api/inlineCompletionApi.ts
- src/api/chatApi.ts
- src/extension.ts

The route POST /v1/completions/inline is IMPLEMENTED — do NOT rewrite from scratch.

Implement ALL below. Run autonomously. Do not commit unless asked.

## C1 — Verify server
- Rebuild: docker compose up -d --build api
- POST /v1/completions/inline with test body; confirm 200 (not 501)

## C2 — Wire accept/reject telemetry
- Call noteSuggestionAccepted / noteSuggestionRejected from CoopAutocompleteProvider
- If Agent D's POST /v1/usage/events exists, emit completion.accepted / completion.rejected

## C3 — Keybinding context
- On extension activate + when coopAI.autocomplete.enabled changes:
  vscode.commands.executeCommand('setContext', 'coopAI.autocomplete.enabled', value)

## C4 — Model preset alignment
- Align default model in completionRouter.ts with inlineCompletionApi.ts

## C5 — Server test
- Add src/api/inlineCompletionApi.test.ts with COOP_LLM_MOCK or mock router

## C6 — Update stale docs
- docs/roadmap.md §2 — check off completed items, remove 501 claim
- docs/production-readiness-assessment.md — correct autocomplete section

## C7 — Optional: enable in dev defaults
- Do NOT change default to true in package.json (keep false for prod safety)
- Add comment in package.json description that users enable in Settings

## Verification
- npm run lint
- Run new inline test
- Document Extension Development Host steps: enable coopAI.autocomplete.enabled, type in .ts file

Report: confirmation inline route works, files changed, dogfood steps.
```

---

## Agent A — Multi-Repo Search + @ Picker

**Start after:** P1  
**Parallel with:** C, D  
**Owns:** collections admin UI, graphSearch collectionId, @ picker, mentions pipeline  
**Do not touch:** usage_events (D), admin /analytics page (B)

### Copy-paste into new chat

```
You are Agent A — Coop AI multi-repo search + @ file mentions.

Repo: /Users/jonraney/Desktop/Coop AI

Read first:
- docs/feature-gap-handoff.md § Thread A
- docs/roadmap.md §1
- src/indexing/lightningSearch.ts
- src/server/collectionStore.ts
- src/server/orgApi.ts (/v1/collections)
- src/api/CoopBackendClient.ts
- src/api/types.ts (V1ChatRequestBody.mentions)
- src/chat/CoopChatSession.ts
- src/prompts/systemPrompts.ts (formatChatMessageWithLocalFiles pattern)

Do NOT rebuild SCIP/Zoekt indexing. Wire existing backend into product.

Implement ALL below in order. Run autonomously. Do not commit unless asked.

## A1 — Extend types
- V1ChatRequestBody.mentions: add repoId to each mention { repoId, path, lines? }
- Extension chat types mirror this

## A2 — CoopBackendClient.graphSearch
- Add optional collectionId param
- GET /graph/:repoId/search?pattern=&collectionId=

## A3 — CloudIndexBackend.search
- Pass collectionId through to graphSearch

## A4 — Admin collections page
- admin/src/app/(admin)/collections/page.tsx
- CRUD via /v1/collections (orgApi.ts routes)
- admin/src/lib/coopApi.ts methods
- Sidebar link in admin/src/components/Sidebar.tsx
- List org repos with Lightning status where available

## A5 — Extension search scope
- Settings → Workspace: dropdown "Search scope" — Active repo (default) | Collection [pick]
- Persist in user preferences
- Pass collectionId to graphSearch calls

## A6 — @ picker in chat composer
- Debounced @ trigger in chat UI (webview)
- RPC to extension → graphSearch(pattern, collectionId?)
- Show results with repoId + path; cap 3 selections
- On send: include mentions[] in chat payload

## A7 — Resolve mentions to context
- For each mention: fetch content via
  (a) lightning hit snippet from server, OR
  (b) code-host file fetch for full file (zero-clone path) when lines omitted
- Inject via systemPrompts (attached_context block with repoId per file)
- Wire mentions through SecureApiClient → /v1/chat if server-side resolution preferred

## A8 — Fix nightly index-all job
- jobQueueConfig.ts + scheduler: enumerate org repos with Lightning enabled, enqueue INDEX_REPOSITORY per repoId
- Add org plan filter (pro/enterprise only)

## A9 — Zoekt repo scoping (improve accuracy)
- lightningSearch.ts collectZoektHits: scope query to repoIds set instead of post-hoc string match

## Out of scope v1
- @symbol, Slack @users, cross-repo symbol navigation

## Verification
- Admin: create collection with 2 repos
- Extension: set collection scope, @ picker returns files from both repos
- Chat message includes attached context from mentioned file in another repo
- npm run lint

Report: UX walkthrough, files changed, any backend-only gaps remaining.
```

---

## Agent B — Admin Analytics Dashboard

**Start after:** Agent D delivers `/v1/admin/analytics/*` + usage_events  
**Owns:** `admin/src/app/(admin)/analytics/`  
**Do not touch:** UsageTracker instrumentation (D), collections (A)

### Copy-paste into new chat

```
You are Agent B — Coop AI admin analytics dashboard.

Repo: /Users/jonraney/Desktop/Coop AI

Read first:
- docs/feature-gap-handoff.md § Thread B
- https://sourcegraph.com/docs/admin/analytics (KPI inspiration)
- src/server/adminAnalyticsApi.ts (from Agent D — read actual implementation)
- admin/src/app/(admin)/page.tsx (dashboard patterns)
- admin/src/lib/coopApi.ts

Prerequisite: Agent D completed usage_events + admin analytics API routes.

Implement ALL below. Run autonomously. Do not commit unless asked.

## B1 — Admin analytics page
- admin/src/app/(admin)/analytics/page.tsx
- Tabs: Overview | Chat & Actions | Lightning | Completions | Integrations | Users
- Date range: 7d / 30d / 90d
- Fetch from /v1/admin/analytics/* endpoints

## B2 — Overview tab (Sourcegraph-inspired)
- Total org users, DAU, MAU (from API)
- Seat utilization (used / purchased)
- Event volume chart or table by day
- Optional: estimated hours saved (configurable multiplier × chat + quick actions) — static config OK for v1

## B3 — Chat & Actions tab
- Chat messages by day
- Quick action breakdown by type
- Top active users table

## B4 — Lightning tab
- Repos indexed count
- Search queries (lightning.search events)
- Index job success/failure if queryable

## B5 — Completions tab
- Suggested vs accepted (when events exist)
- CAR % if both counters available
- Placeholder callout if Agent C/D events not yet flowing

## B6 — Integrations tab
- Connected providers count
- Integration test events if tracked

## B7 — Users tab
- Active users list with last active date
- Link to /users for management

## B8 — CSV export
- Button calls /v1/admin/analytics/export.csv
- Download in browser

## B9 — Navigation + docs
- Add Analytics to Sidebar.tsx
- Update admin/README.md (remove stale "billing placeholder" claims)

Match existing admin Tailwind/coop-* styling. No new chart library required for v1 — Stat cards + tables OK.

## Verification
- npm run lint in admin/
- Page loads with mock/empty data without crash
- CSV download works

Report: screenshots description, API dependencies, empty states handled.
```

---

## Agent P2 — Self-Serve Pro MVP (Deploy + Config)

**Start after:** P1 complete  
**Needs operator:** Stripe keys, Resend key, deploy access  
**Owns:** env templates, website env docs, port fixes, billing polish, deploy guides  
**Do not touch:** feature code owned by A/B/C/D unless fixing port/env bugs

### Copy-paste into new chat

```
You are Agent P2 — Coop AI self-serve Pro MVP (deploy + config wiring).

Repo: /Users/jonraney/Desktop/Coop AI

Read first:
- docs/production-readiness-assessment.md (Phase 2, env checklist)
- docs/feature-gap-handoff.md (self-serve pricing section)
- src/server/billing/billingConfig.ts
- website/src/app/api/checkout/route.ts
- website/.env.example
- admin/.env.example
- admin/package.json (port 3001)
- src/server/adminApiKeysApi.ts (lastUsed vs lastUsedAt bug)

Implement ALL below. Run autonomously. Do not commit unless asked.
Do NOT paste or commit secrets. Update .example files only.

## P2-1 — Fix port consistency
- billingConfig.ts default admin portal: http://localhost:3001 (match admin/package.json)
- welcome/page.tsx default: 3001
- Document in admin/README.md

## P2-2 — Website env template
- website/.env.example: add COOP_API_BASE, NEXT_PUBLIC_ADMIN_PORTAL_URL with production examples

## P2-3 — Admin env template
- admin/.env.example: NEXT_PUBLIC_COOP_API_BASE

## P2-4 — Admin UI bugfixes
- coopApi.ts + api-keys page: fix lastUsed vs lastUsedAt field mismatch
- audit page: wire nextCursor pagination if API supports it
- adminIntegrationsApi detail vs metadata if quick fix available

## P2-5 — Billing webhook hardening
- billingApi.ts: webhook event id dedup table or check (migration 015 if needed)
- Fix audit orgId bug on checkout (uses stripe customer id instead of org uuid)
- handle invoice.payment_failed → set billing_status past_due

## P2-6 — Deploy guide (new doc)
- docs/deploy-self-serve-pro.md with sections:
  - File: .env.backend production vars (Stripe, Resend, CORS, COOP_PUBLIC_BASE_URL)
  - Terminal: docker compose production overrides
  - Stripe dashboard: webhook URL + events
  - Vercel: website env vars
  - Admin: deploy to Vercel/host with env
  - Browser: test signup flow end-to-end
  - Success: email with API key, admin login, billing portal opens

## P2-7 — Welcome page improvement
- welcome/page.tsx: read ?session_id= from URL, show "Provisioning may take a minute" + retry admin link

## Verification
- npm run lint
- Document operator checklist (what human must paste from Stripe/Resend consoles)

Report: deploy doc path, env var table, remaining operator-only steps.
```

---

## Operator checklist (you — not agents)

Do these while agents run. Secrets go in `.env.backend` (gitignored) and Vercel dashboard — **not in repo**.

### File — `.env.backend` (add when ready)

| Variable | Source |
|----------|--------|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → signing secret |
| `STRIPE_PRICE_ID_PRO` | Stripe Dashboard → Products → $20/mo price ID |
| `RESEND_API_KEY` | resend.com → API Keys |
| `COOP_EMAIL_MOCK=false` | Set after Resend key added |
| `COOP_REQUIRE_API_AUTH=true` | Production |
| `COOP_PUBLIC_BASE_URL=https://api.coopai.dev` | Your API host |
| `COOP_CORS_ORIGINS=https://admin.coop-ai.dev,https://coop-ai.dev` | Comma-separated |
| `COOP_ADMIN_PORTAL_URL=https://admin.coop-ai.dev` | Admin deploy URL |

### Terminal — after Agent P1

```bash
cd "/Users/jonraney/Desktop/Coop AI"
docker compose up -d --build
./scripts/migrate.sh   # after P1 creates it
```

### Browser — Stripe

1. Webhook endpoint: `https://api.coopai.dev/webhooks/stripe`
2. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

### Browser — Vercel (website project)

- `COOP_API_BASE=https://api.coopai.dev`
- `NEXT_PUBLIC_ADMIN_PORTAL_URL=https://admin.coop-ai.dev`

---

## Success criteria — end of day

| Agent | Done when |
|-------|-----------|
| **P1** | CI green, auth hardened, migrate.sh works, Slack scopes fixed, duplicates gone |
| **D** | Seat limit blocks over-invite; usage_events populated on chat; analytics API returns data |
| **C** | Inline completion 200 in docker; accept/reject wired; docs updated |
| **A** | Admin collections page; @ picker attaches cross-repo file context in chat |
| **B** | `/analytics` page with tabs + CSV export |
| **P2** | Deploy doc complete; port/env bugs fixed; operator can run signup test |

**Full product ready for paying customer:** P1 + P2 + operator secrets + extension publish (VSIX or Marketplace — separate from today's agents).

---

## If agents conflict

| File area | Owner |
|-----------|-------|
| docker-compose, authMiddleware, CI, migrate.sh | P1 |
| migrations/014+, usageTracker, adminUsersApi seats | D |
| src/autocomplete/, inline tests | C |
| admin/collections, webview @ picker, graphSearch client | A |
| admin/analytics page | B |
| billing polish, deploy docs, website env | P2 |

If two agents touch the same file, **P1 wins on infra**; **D wins on usage_events**; merge manually.

---

## Quick reference links

- Sourcegraph analytics KPIs: https://sourcegraph.com/docs/admin/analytics
- Connect checklist: [connect-integrations-production.md](./connect-integrations-production.md)
- Roadmap: [roadmap.md](./roadmap.md)
