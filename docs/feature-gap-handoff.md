# Feature Gap Handoff — Game Plan for Separate Threads

**Created:** June 10, 2026  
**Purpose:** Hand this doc to **new Cursor chats** (one thread per workstream). Keep **this original thread** for the [3-phase production action plan](/Users/jonraney/.cursor/projects/Users-jonraney-Desktop-Coop-AI/canvases/coop-production-readiness.canvas.tsx) (security, CI, deploy, env).

**Do not start building in those threads until Phase 1 blockers are addressed** — analytics and autocomplete both depend on a running, auth-enabled API with audit logging.

---

## Corrections to the production readiness assessment

| Prior claim | Corrected status |
|-------------|------------------|
| "No self-serve pricing" | **Wrong.** Pro at **$20/user/month** is self-serve via Stripe checkout (`website/src/app/pricing/page.tsx` → `/signup` → `/api/checkout` → `POST /v1/billing/checkout-session`). Gap is **deploy/env polish**, not missing checkout. Developer tier is waitlist-only. |
| "Autocomplete returns 501" | **Stale.** Current source implements `POST /v1/completions/inline` end-to-end. No 501 in that path. Gap is **default-off setting**, accept/reject wiring, tests, deploy verification — not greenfield implementation. |
| "Lightning = multi-repo search" | **Partially true.** Lightning indexes **per repo** (SCIP + Zoekt + embeddings). Backend has **org collections** for cross-repo search, but extension/chat never sends `collectionId`. Not comparable to Sourcegraph @-mention multi-repo UX yet. |

---

## Thread map (open one new chat per row)

| Thread | Workstream | Est. effort | Depends on |
|--------|------------|-------------|------------|
| **A** | Multi-repo search + collections UX | 2–3 weeks | Phase 1 API deploy |
| **B** | Admin analytics dashboard | 2–3 weeks | Usage event instrumentation (Thread D) |
| **C** | Autocomplete ship (T0 polish) | 3–5 days | Phase 1 API + LLM keys |
| **D** | Usage telemetry + seat enforcement | 1–2 weeks | Phase 1 migrations applied |

Threads **B** and **D** should be sequenced: **D first** (instrument + enforce), then **B** (admin UI). Threads **A** and **C** are independent.

---

## Thread A — Multi-repo indexed search (Sourcegraph gap)

### Copy-paste prompt for new chat

```
Workstream: Coop AI multi-repo search (Sourcegraph gap closure)

Read docs/feature-gap-handoff.md § Thread A and implement in order.

Goal: Wire existing Lightning/collection backend into extension + chat so Pro users can search/index across multiple repos — not just the single active repo.

Do NOT rebuild indexing — SCIP/Zoekt/embeddings per repo already work. Focus on product wiring and UX.
```

### What Lightning Mode already does

| Capability | Status | Evidence |
|------------|--------|----------|
| Per-repo SCIP symbol index | Shipped | `runScipIndexer.ts`, `repo_symbol_index` |
| Per-repo Zoekt full-text | Shipped | `runZoektIndexer.ts`, `{ZOEKT_INDEX_PATH}/{orgId}/{repoId}/` |
| Per-repo embeddings | Shipped | `008_repo_embeddings.sql`, `chunkAndEmbed` |
| Org-scoped storage | Shipped | All tables keyed by `org_id` |
| Collection API (group repos) | Backend only | `migrations/009_org_collections.sql`, `CollectionStore`, `orgApi.ts` `/v1/collections` |
| Cross-repo search via `collectionId` | Backend only | `lightningSearch.ts` + `GET /graph/:repoId/search?collectionId=…` |
| Extension multi-repo search | **Missing** | `CoopBackendClient.graphSearch()` sends only `pattern`, no `collectionId` |
| Chat scoped to one repo | **Missing** | `buildRepoId()` → single `provider:owner/repo` |
| @-mention file picker | **Missing** | `docs/roadmap.md` §1 — explicitly deferred |
| Collection admin UI | **Missing** | No admin or extension UI for collections |
| Nightly "index all repos" | **Broken** | `jobQueueConfig.ts` enqueues `INDEX_REPOSITORY` without `repoId` |

### Gap vs Sourcegraph

Sourcegraph delivers **global search + @-mention remote repos in chat** with permission-aware results. Coop delivers **strong single-repo hybrid search** with backend scaffolding for collections that the product never exposes.

### Build plan (ordered)

**A1 — Collections CRUD in admin portal** (~3 days)

- Admin page `/collections`: list collections, create/rename, add/remove repos from org's indexed repos
- API client methods in `admin/src/lib/coopApi.ts` wrapping existing `/v1/collections` routes in `orgApi.ts`
- Show which repos have Lightning enabled vs not

**A2 — Extension collection picker** (~3 days)

- Settings → Workspace: optional "Search scope" — single repo (default) or named collection
- Persist in user preferences / org settings
- Pass `collectionId` to `CoopBackendClient.graphSearch()` and `CloudIndexBackend.search()`

**A3 — Wire graph search client** (~2 days)

- Extend `CoopBackendClient.graphSearch(baseUrl, repoId, pattern, collectionId?)`
- Extend `CloudIndexBackend.search()` to pass `collectionId` query param
- Fix Zoekt repo scoping in `lightningSearch.ts` — today uses global query + heuristic repo mapping (`repoIdFromZoektRepo`)

**A4 — @-mention file picker (roadmap §1)** (~1 week)

- `@` picker in chat composer → debounced `graphSearch` with active scope (repo or collection)
- `MentionAttachment` on chat send → resolve to context block
- Cap: 3 files, token budget (per roadmap)
- **Out of scope v1:** cross-repo @symbol, Slack @users

**A5 — Fix nightly index-all job** (~1 day)

- Scheduler should enumerate org repos with Lightning enabled and enqueue per-repo jobs
- Add plan filter (`jobQueueConfig.ts` TODO)

**A6 — Marketing copy alignment** (~1 hour)

- `LightningModePanel.tsx` and pricing page say "cross-repo search" — accurate only after A2–A4 ship

### Acceptance criteria

- Org admin creates collection "Platform team" with 3 repos in admin portal
- Developer sets search scope to that collection in Settings → Workspace
- Chat `@` picker returns files from any repo in the collection
- `GET /graph/.../search?collectionId=…&pattern=foo` returns ranked hits with `repoId` on each result
- Knowledge Gaps / hybrid context can optionally use collection scope (stretch)

### Key files

- `src/indexing/lightningSearch.ts`
- `src/server/collectionStore.ts`
- `src/server/orgApi.ts`
- `src/api/CoopBackendClient.ts`
- `src/indexing/cloudIndexBackend.ts`
- `src/chat/CoopChatSession.ts` (`buildRepoId`)
- `src/webview/components/settings/SettingsDetailViews.tsx` (WorkspaceDetail)
- `admin/src/app/(admin)/` (new collections page)

---

## Thread B — Admin analytics dashboard (Sourcegraph-inspired)

### Copy-paste prompt for new chat

```
Workstream: Coop AI admin analytics dashboard

Read docs/feature-gap-handoff.md § Thread B.

Reference: Sourcegraph Analytics docs — https://sourcegraph.com/docs/admin/analytics

Prerequisite: Thread D usage_events table and instrumentation must exist (or build D first in same thread).

Goal: New admin portal page /analytics with KPI cards, charts, and CSV export — mapped to Coop's actual product surface (chat, quick actions, Lightning, integrations, autocomplete).
```

### Sourcegraph inspiration → Coop mapping

Sourcegraph organizes analytics around **usage, engagement, performance, and impact** ([admin analytics docs](https://sourcegraph.com/docs/admin/analytics)). Map to Coop's product:

#### Overview tab (exec summary)

| Sourcegraph metric | Coop equivalent | How to measure |
|--------------------|-----------------|----------------|
| Total users | Org members (active + invited) | `users` table |
| Average DAU | Unique principals with any event/day | `usage_events` (Thread D) |
| Monthly active users | Unique principals/month | `usage_events` |
| Total hours saved | Estimated ROI | Configurable minutes × event counts (chat, quick actions, completions) |
| Daily active users chart | DAU over time | Aggregate query |

#### Chat & AI tab

| Metric | Coop source |
|--------|-------------|
| Total chat messages / sessions | `audit_log` action `chat.completion` + new `usage_events` type `chat.message` |
| Chat users by day | Distinct `user_id` per day |
| Quick action usage by type | Events: `quick_action.trace_decision`, `quick_action.find_owner`, `quick_action.blast_radius`, `quick_action.knowledge_gaps`, `quick_action.repo_summary` |
| LLM tokens / cost estimate | Extend chat audit metadata (provider, model, usage from ModelRouter) |
| Chat apply/insert rate | Future — requires extension telemetry |

#### Lightning / Code Search tab

| Metric | Coop source |
|--------|-------------|
| Repos with Lightning enabled | `org_repos` or Lightning status API |
| Index job success/failure | `jobs` table by type `INDEX_REPOSITORY` |
| Hybrid search queries | New event `lightning.search` when `graphSearch` / `lightningSearch` runs |
| SCIP symbol lookups | New event `lightning.symbols` |
| Knowledge gap scans | Jobs type `SCAN_KNOWLEDGE_GAPS` |

#### Completions tab (when Thread C ships)

| Sourcegraph metric | Coop equivalent |
|--------------------|-----------------|
| Completion suggestions | Event `completion.suggested` |
| Completion acceptances | Event `completion.accepted` (wire `noteSuggestionAccepted`) |
| CAR (acceptance rate) | accepted / suggested |
| Latency (ms) | Server `latencyMs` in inline response |
| Acceptance by language | Group by file extension from context |

#### Integrations tab

| Metric | Coop source |
|--------|-------------|
| Connected integrations by provider | `org_integration_connections` |
| Integration test success rate | Audit or events from Connect/Test flows |
| Degraded feature runs | `runFeatureFallback` invocations |

#### Users tab

| Metric | Coop source |
|--------|-------------|
| Active users list | Join users + usage aggregates |
| Last active | Max `usage_events.timestamp` per user |
| Seat utilization | `active_users / seat_count` |

#### Billing tab (ties to Thread D)

| Metric | Coop source |
|--------|-------------|
| Seats purchased vs active | `organizations.seat_count` vs active user count |
| Plan | `organizations.plan` |
| Stripe subscription status | `billing_status` |

### Admin UI build plan

**B1 — API routes** (~3 days)

- `GET /v1/admin/analytics/overview?from=&to=`
- `GET /v1/admin/analytics/chat?from=&to=`
- `GET /v1/admin/analytics/lightning?from=&to=`
- `GET /v1/admin/analytics/completions?from=&to=`
- `GET /v1/admin/analytics/users?from=&to=`
- `GET /v1/admin/analytics/export.csv?from=&to=&groupBy=`

Register in `adminApi.ts`. Gate: `requireOrgAdmin`.

**B2 — Admin page** (~4 days)

- New route `admin/src/app/(admin)/analytics/page.tsx`
- Sub-nav tabs: Overview | Chat & Actions | Lightning | Completions | Integrations | Users
- Date range picker (7d / 30d / 90d / custom)
- Stat cards + simple charts (use existing admin Tailwind patterns — no new chart lib required for v1; tables + stat cards OK)
- CSV export button

**B3 — Sidebar + copy** (~1 day)

- Add Analytics to `admin/src/components/Sidebar.tsx`
- Update `admin/README.md`

### CSV export columns (v1)

Mirror Sourcegraph's export shape where applicable:

| Column | Description |
|--------|-------------|
| user_id | Org user UUID |
| email | If available |
| date | Activity date |
| client | `vscode.extension` |
| chat_messages | Count |
| quick_actions | Count by type (or separate columns) |
| lightning_searches | Count |
| completions_suggested | Count |
| completions_accepted | Count |
| car | Rate |

### Acceptance criteria

- Org admin opens `/analytics` and sees DAU, chat volume, quick action breakdown for last 30 days
- CSV export downloads with user-day granularity
- Empty state when no usage events yet (not broken UI)
- Page returns 503 gracefully if `usage_events` table missing (pre-migration)

### Key files

- `admin/src/app/(admin)/analytics/page.tsx` (new)
- `src/server/adminAnalyticsApi.ts` (new)
- `src/server/adminApi.ts`
- `admin/src/lib/coopApi.ts`
- Reference: [Sourcegraph Analytics metrics](https://sourcegraph.com/docs/admin/analytics)

---

## Thread C — Autocomplete ship (T0 polish)

### Copy-paste prompt for new chat

```
Workstream: Coop AI autocomplete T0 ship

Read docs/feature-gap-handoff.md § Thread C.

The inline completion route is IMPLEMENTED — do not rewrite from scratch. Verify, polish, test, and enable for dogfooding.

Goal: Ghost-text autocomplete working in Extension Development Host with coopAI.autocomplete.enabled=true.
```

### Current state (verified)

| Layer | Status | File |
|-------|--------|------|
| Server route | Implemented | `src/api/chatApi.ts` → `inlineCompletionApi.ts` |
| ModelRouter.completeInline | Implemented | `src/api/ModelRouter.ts` |
| Inline system prompt | Implemented | `src/prompts/systemPrompts.ts` (`inline_completion`) |
| Zero-retention headers | Implemented | `zeroRetentionConfig.ts`, client sends `x-use-case: code-completion-only` |
| Extension provider | Implemented | `src/autocomplete/coopAutocompleteProvider.ts` |
| Registration | Implemented | `src/extension.ts` `registerCoopAutocomplete` |
| Settings | Default **off** | `coopAI.autocomplete.enabled` in `package.json` |
| Accept/reject telemetry | **Not wired** | `noteSuggestionAccepted` / `noteSuggestionRejected` exist but uncalled |
| Keybinding context | **Gap** | `coopAI.autocomplete.enabled` context not set via `setContext` |
| Tests | **Missing** | No `inlineCompletionApi.test.ts` |
| Docs | **Stale** | `roadmap.md` still says 501 |

### Build plan (ordered)

**C1 — Verify server** (~2 hours)

- Terminal: rebuild API, `POST /v1/completions/inline` with mock or real LLM key
- Confirm 200 response shape `{ text, model, provider, latencyMs }`

**C2 — Wire accept/reject** (~1 day)

- Call `noteSuggestionAccepted` / `noteSuggestionRejected` from `CoopAutocompleteProvider` on user action
- Enables backoff + future CAR metrics (Thread D/B)

**C3 — Fix keybinding context** (~2 hours)

- On activation + setting change: `vscode.commands.executeCommand('setContext', 'coopAI.autocomplete.enabled', value)`
- Ensures Alt+[/] keybindings work

**C4 — Align model preset** (~1 hour)

- `completionRouter.ts` vs `inlineCompletionApi.ts` default model IDs

**C5 — Server test** (~1 day)

- Mock-mode integration test for inline route

**C6 — Update docs** (~1 hour)

- Fix `roadmap.md`, `production-readiness-assessment.md` — remove 501 claims, check off T0 items

**C7 — Dogfood checklist**

- File: enable `coopAI.autocomplete.enabled` in settings
- Extension UI: toggle in Settings → Preferences or chat top bar
- Type in `.ts` file → ghost text appears

### Acceptance criteria

- With `coopAI.autocomplete.enabled: true`, typing in TypeScript produces inline ghost text within ~400ms debounce
- Accepting/rejecting suggestions updates backoff behavior
- Audit log records `completion.inline` per request
- No 501 from current API build

### Key files

- `src/autocomplete/` (entire directory)
- `src/api/inlineCompletionApi.ts`
- `src/extension.ts`
- `docs/roadmap.md` §2

---

## Thread D — Usage telemetry + seat enforcement (DX/Swarmia gap)

### Copy-paste prompt for new chat

```
Workstream: Coop AI usage telemetry + seat enforcement

Read docs/feature-gap-handoff.md § Thread D.

Build BEFORE Thread B (admin analytics UI reads from this data).

Goal: (1) Enforce seat_count on user invites. (2) Instrument usage events for analytics KPIs.
```

### Seat enforcement (today)

- `seat_count` stored on checkout (`provisionOrg.ts`, `013_org_billing.sql`)
- **Never checked** on `POST /v1/admin/users/invite` (`adminUsersApi.ts`)
- Stripe subscription quantity not synced on portal changes

### Build plan

**D1 — Seat enforcement** (~2 days)

- In `adminUsersApi.ts` invite handler:
  - Count active users + pending invites
  - If `count >= organization.seatCount`, return `403` with `{ error: "seat_limit_reached", seats, used }`
- Admin UI: show "X of Y seats used" on `/users` and `/billing`
- Optional: sync seat count from Stripe `customer.subscription.updated` webhook (read `quantity`)

**D2 — Usage events schema** (~1 day)

New migration `014_usage_events.sql`:

```sql
CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT,
  principal TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- e.g. chat.message, quick_action.*, completion.*, lightning.search
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_org_created ON usage_events (org_id, created_at DESC);
CREATE INDEX usage_events_type ON usage_events (org_id, event_type, created_at DESC);
```

**D3 — Instrumentation** (~3 days)

| Event type | Emit from |
|------------|-----------|
| `chat.message` | `chatApi.ts` after successful stream |
| `completion.inline` | Already audited — duplicate to `usage_events` or query audit_log |
| `completion.accepted` / `completion.rejected` | Extension via new `POST /v1/usage/events` batch endpoint |
| `quick_action.*` | `CoopChatSession.ts` quick action handlers |
| `lightning.search` | `lightningSearch.ts` or graph search route |
| `lightning.enable` | Cloud index enable API |
| `integration.test` | Integration test RPC |

Lightweight helper: `UsageTracker.record({ orgId, userId, principal, eventType, metadata })`.

**D4 — Extension usage batch endpoint** (~1 day)

- `POST /v1/usage/events` — accept array of events from extension (autocomplete accept/reject, quick actions)
- Rate-limit per org

### Acceptance criteria

- Inviting user #6 when `seat_count=5` returns clear error in admin UI
- `/users` shows seat utilization bar
- Usage events appear in DB after chat + quick action
- Thread B analytics API can query `usage_events`

### Key files

- `src/server/adminUsersApi.ts`
- `src/server/billing/billingApi.ts` (subscription quantity sync)
- `src/server/orgStore.ts`
- `migrations/014_usage_events.sql` (new)
- `src/server/usageTracker.ts` (new)
- `admin/src/app/(admin)/users/page.tsx`

---

## Recommended thread order

```text
Phase 1 (this thread)     →  security, CI, migrations, env
         ↓
Thread D                  →  usage_events + seat enforcement  (foundation for analytics)
         ↓
Thread B                  →  admin analytics dashboard
         ↓
Thread C                  →  autocomplete polish  (parallel with B after Phase 1)
Thread A                  →  multi-repo search  (parallel; largest scope)
```

**Thread C** and **Thread A** can run in parallel with **D→B** once Phase 1 is done.

---

## Self-serve pricing — no separate thread needed

Pro self-serve is **already built**. Remaining work belongs in **Phase 2** of the production plan (not a feature thread):

1. Wire website env on Vercel (`COOP_API_BASE`, `NEXT_PUBLIC_ADMIN_PORTAL_URL`)
2. Configure Stripe webhook on production API
3. Set `RESEND_API_KEY` + `COOP_EMAIL_MOCK=false`
4. Fix welcome page / admin portal URL port mismatch (3001 vs 3002)

Update competitive positioning: **Coop matches Augment/Cursor on self-serve Pro pricing ($20/mo)**. Differentiator is cross-tool integrations + quick actions, not checkout mechanics.

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [production-readiness-assessment.md](./production-readiness-assessment.md) | Full audit (needs corrections above) |
| [coop-production-readiness.canvas.tsx](/Users/jonraney/.cursor/projects/Users-jonraney-Desktop-Coop-AI/canvases/coop-production-readiness.canvas.tsx) | 3-phase action plan for this thread |
| [roadmap.md](./roadmap.md) | @-mentions §1, autocomplete §2 |
| [Sourcegraph admin](https://sourcegraph.com/docs/admin) | Admin feature taxonomy |
| [Sourcegraph analytics](https://sourcegraph.com/docs/admin/analytics) | KPI inspiration for Thread B |
