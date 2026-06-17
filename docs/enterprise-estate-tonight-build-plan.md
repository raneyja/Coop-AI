# Enterprise Estate Build — Tonight Parallel Plan

**Created:** June 15, 2026  
**Updated:** June 15, 2026 — aligned tier model + Pro onboarding + MCP  
**Goal:** Enterprise = full estate code graph (+ MCP later). Pro = self-serve deep index on chosen repos (max 3/seat).

**Companion docs:**
- [agent-launch-playbook.md](./agent-launch-playbook.md) — P1/D/C/A/B (marked complete on `main`)
- [production-readiness-assessment.md](./production-readiness-assessment.md) — launch blockers
- [deploy-railway.md](./deploy-railway.md) — API Phase 1; **Phase 2 = worker + Zoekt**
- [feature-gap-handoff.md](./feature-gap-handoff.md) — Thread A (collections; partially shipped)
- [deploy-production-handoff.md](./deploy-production-handoff.md) — launch checklist (integrations, Stripe, Phase 2)

---

## Aligned product decisions (for agents — do not contradict)

| Tier | Indexing | Search scope | Upgrade trigger |
|------|----------|--------------|-----------------|
| **Developer (free)** | Zero-Clone only | Active repo | — |
| **Pro** | **Org catalog** indexed at onboarding (estate sync) | Cross-repo across **this user's workspace repos** (≤3) | — |
| **Enterprise** | **Org catalog** indexed at onboarding (estate sync) | Cross-repo across **this user's workspace repos** (≤3); org-wide search optional | — |

**Two-layer model:**
1. **Org catalog (admin, step 1):** Index repos from **GitHub, GitLab, and Bitbucket** into `org_repos` when admin connects each host in the admin portal.
2. **User workspace (each developer, step 2):** Pick up to **3 repos per seat** from that catalog → stored in `user_workspace_repos`. Search scope `indexed` and the chat folder picker use **this user's** selection only.

**Pricing copy (marketing + in-app):**
- **Pro:** Org indexes your estate; each developer picks up to 3 **workspace repos** + **Coop-Search** across them
- **Enterprise:** Same workspace model + MCP + SSO extras

**MCP:** Enterprise only. Ship **after** estate index (E1) + org search (E2). Not Pro.

**Pro onboarding principle:** Users must be **independent** — no admin required to pick repos. First-run + Lightning panel: connect GitHub → choose up to 3 repos → **Deep-Code Graph** indexing in the cloud → **Coop-Search** across **Deep-Indexed Repos**.

**User-facing copy rules (marketing, extension, admin, onboarding — not agent/dev docs):**
- **Never** mention SCIP, Zoekt, Lightning Mode internals, or **Sourcegraph** (or any competitor name).
- **Use:** **Deep-Code Graph** indexing, **Deep-Indexed Repos**, **Coop-Search**.
- **Pro cap:** **3 repos per seat** (confirmed for v1).

**Pro cap rationale:** Covers primary service + 1–2 shared libs for most IC engineers; Enterprise for estate-wide index + MCP.

---

## Tonight — honest scope

| Tier | What you can finish tonight | What you cannot |
|------|----------------------------|-----------------|
| **Must ship** | E1 estate sync (**enterprise only**); P1 Pro repo picker + 3-repo cap; E2 dual scope (Pro=indexed repos, Enterprise=org); E3 admin indexing UI | MCP server (Phase 2) |
| **Stretch** | E4 chat/blast use indexed/org scope; first-run wizard polish | Per-user GitHub ACL filtering |
| **Operator only** | Railway Phase 2 (worker + Zoekt volume), production env, Stripe/Resend smoke | Agents should not paste secrets |

**Local stack tonight:** `docker compose up -d --build` gives API + worker + Zoekt + Postgres — **full Lightning path**. Railway without Phase 2 only gets API/chat, not Zoekt.

---

## What is already done (do not re-assign)

Per [agent-launch-playbook.md](./agent-launch-playbook.md) launch status:

| Track | Status |
|-------|--------|
| P1 security, migrations, CI | Done |
| D telemetry + seats | Done |
| C autocomplete | Done |
| A collections + @ picker + search scope settings | Done (verify; feature-gap doc is stale) |
| B admin analytics | Done |
| Admin `/collections` page | Shipped |

**Still open / in progress:**
- Operator production deploy (Railway Phase 1 API) — **done** (api.coop-ai.dev)
- All production integrations OAuth — **done** (GitHub, Slack, Jira, Confluence, Notion, Google Docs, Teams)
- Railway **Phase 2** worker + Zoekt (required for prod Lightning search)
- **Estate sync** (GitHub install → all repos → auto Lightning) — **not built**
- **Org-wide default scope** (not just manual collections) — **not built**
- Chat / blast radius still **single-repo** for context — **not wired to org scope**
- Pro **3-repo cap** — **not built**
- Search scope modes `indexed` / `org` — **not built** (only `repo` \| `collection` today)

---

## Architecture target

```text
PRO (individual / small team)
  Connect GitHub → pick ≤3 repos (onboarding + Lightning panel)
    → POST lightning/enable per repo (enforce cap: 3 × seat_count)
    → INDEX_REPOSITORY per chosen repo (SCIP + Zoekt + embeddings)
  searchScope = "indexed" (all lightning_enabled repos for org, max 3)
  chat / @ / blast radius use indexed scope

ENTERPRISE
  GitHub App install (all repos) → EstateSyncService (enterprise only)
    → upsert all org_repos, lightning_enabled=true
    → enqueue INDEX_REPOSITORY for entire estate
  searchScope = "org" (all indexed repos)
  MCP server (Phase 2) exposes same graph to external agents
```

---

## Parallel thread map

Open **one Cursor Agent chat per row**. Paste the full prompt block under each agent.

```text
YOU (Operator)     ─────────────────────────► Railway, secrets, smoke, Phase 2
     │
     ├─ T+0   Agent P1  Pro onboarding + 3-repo cap   (START — independent users)
     ├─ T+0   Agent E1  Estate sync (enterprise only)  (parallel with P1)
     ├─ T+0   Agent OPS Production verify              (parallel)
     ├─ T+45m Agent E2  Search scope (indexed vs org)  (after P1 cap API exists)
     ├─ T+45m Agent E3  Admin indexing UI            (enterprise-focused)
     ├─ T+90m Agent E4  Chat + blast indexed/org scope
     └─ LATER Agent M   MCP server (enterprise, after E1+E2)
```

**Deferred:** E5 internal agent loop — MCP is the external-agent story.

### Global rules (every agent)

1. **Repo root:** workspace root (`/workspace` in cloud agent; your laptop path locally)
2. **Read first:** `AGENTS.md`, `.cursor/rules/webview-ui.mdc` for webview edits
3. **Minimize scope** — no drive-by refactors; no `* 2.*` duplicate files
4. **Do not read or commit** `.env.backend`
5. **Run verification:** `npm run lint`, relevant `npm run test:*`, local `docker compose` smoke where applicable
6. **Report:** files changed, how to verify, what other agents can start next
7. **Owns / do not touch** — respect boundaries below to avoid merge conflicts

---

## YOU — Operator checklist (not an agent)

**Do this first** if production deploy is still in flight. Agents can run on **local docker** in parallel.

### 1. Terminal — local full stack (for agent verification)

```bash
cd /path/to/Coop-AI
docker compose up -d --build
export DATABASE_URL=postgres://coop:coop@localhost:5432/coopai
./scripts/migrate.sh
curl -s http://localhost:8787/health
```

**Success:** JSON with `"status":"ok"` (or equivalent health fields).

### 2. Browser — Railway (if deploying prod)

Follow [deploy-railway.md](./deploy-railway.md) Parts A–C for API + Postgres + env vars.

### 3. Browser — Railway Phase 2 (required for prod Lightning / Zoekt)

From [deploy-railway-phase2-lightning.md](./deploy-railway-phase2-lightning.md):

- Second service: `node dist/workerEntry.js`
- Volume at `/zoekt-indexes`
- Zoekt webserver service
- API env: `ZOEKT_URL=http://<zoekt-internal>:6070`

**Success:** After E1 indexes a repo, `GET /graph/.../search?pattern=foo` returns Zoekt hits in prod.

### 4. File — `.env.backend` (local or Railway Variables)

Ensure at minimum for estate sync testing:

| Variable | Notes |
|----------|--------|
| `CREDENTIALS_ENCRYPTION_KEY` | Required for GitHub installation tokens |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG` | Estate sync needs installation API |
| `COOP_REQUIRE_API_AUTH` | `true` in prod |
| `DATABASE_URL` | Postgres with pgvector |

**Production note:** Test 3 org uses **GitHub OAuth** (`GITHUB_OAUTH_*`), not GitHub App. E1 estate sync requires **GitHub App** — see [deploy-production-handoff.md](./deploy-production-handoff.md) Phase F.

### 5. Extension UI — smoke org

- Create enterprise org + API key (admin CLI or admin portal)
- Connect GitHub App → install on a test org with 2–3 repos
- After **Agent E1**: admin should show all repos queued/indexing

---

## Agent P1 — Pro onboarding + 3-repo cap

**Priority:** START FIRST (parallel with E1)  
**Owns:** Pro repo selection UX, server-side cap enforcement, first-run guidance  
**Do not touch:** estate sync (E1), MCP (M), admin indexing page layout (E3)

### Copy-paste into new chat

```
You are Agent P1 — Coop AI Pro onboarding: independent repo selection + 3-repo-per-seat cap.

Read first:
- docs/enterprise-estate-tonight-build-plan.md § Aligned product decisions + Agent P1
- src/webview/LightningModePanel.tsx
- src/server/orgApi.ts (handleEnableLightning, GET /v1/orgs/repos)
- src/server/orgStore.ts (listOrgRepos, upsertOrgRepo)
- src/indexing/cloudIndexBackend.ts
- src/webview/components/settings/SettingsDetailViews.tsx (Workspace)
- docs/enterprise-integration-onboarding.md (three-role model)

Product rules (confirmed, not final legal copy):
- Pro: user chooses which repos to deep-index (Lightning). Max 3 repos per seat (3 × seat_count for org).
- 4th enable attempt → 403 plan_upgrade_required with message to upgrade to Enterprise.
- Pro users with 2–3 indexed repos get cross-repo search across those repos (not whole GitHub org).
- Enterprise: estate sync indexes everything (Agent E1); Pro never auto-indexes whole org.

Implement:

## P1.1 — Server cap
- Constant PRO_MAX_INDEXED_REPOS_PER_SEAT = 3
- On POST /v1/orgs/repos/:repoId/lightning/enable:
  - If plan=pro: count org_repos where lightning_enabled=true; compare to seat_count × 3 (from org billing / seat table — see Thread D usage_events or billing tables)
  - If at cap: 403 { error: "repo_limit", message: "...", upgrade: "enterprise" }
  - If plan=enterprise: no per-seat repo cap (estate sync handles scale)
- GET /v1/me: add indexedRepoCount, indexedRepoLimit, canEnableMoreRepos

## P1.2 — Pro repo picker (extension)
- LightningModePanel: "Your Deep-Indexed Repos (N/3)" list with enable/disable per repo
- Flow for new Pro user:
  1. Connect GitHub (existing Connections)
  2. Set workspace default repo (existing Workspace settings)
  3. "Add repo" — browse repos you can access (GitHub) OR enter owner/repo
  4. Enable **Deep-Code Graph** indexing → show queued/indexing/ready per repo
- When at cap: disable add button; show upgrade CTA to Enterprise (link to pricing/demo)

## P1.3 — First-run / onboarding hints (self-serve)
- On first Pro connection (no indexed repos): show coop-notice in Lightning panel:
  "Index up to 3 repos for Deep-Code Graph indexing. Coop-Search works across every Deep-Indexed Repo you add."
- User-facing strings only — no SCIP, Zoekt, Sourcegraph, or competitor names (see copy rules above)
- Optional: lightweight checklist in Settings or Lightning panel (not full wizard):
  [ ] Account connected  [ ] GitHub connected  [ ] At least 1 repo indexed
- Do NOT require admin portal or collections setup for Pro

## P1.4 — Search scope default for Pro
- When indexed repos > 1: default searchScope.mode to "indexed" (new mode) — search all user's lightning_enabled repos
- When 1 repo: default "repo" (active repo)
- Settings labels: Active repo | Deep-Indexed Repos (N) | Collection (optional, advanced)

## P1.5 — Tests
- Unit test: cap logic at 3/seat, enterprise bypasses cap
- Test enable 4th repo on pro org → 403

Verification:
- npm run lint
- Pro org with 1 seat: enable 3 repos OK, 4th fails
- Lightning panel shows onboarding copy for empty state

Report: UX copy used, API fields on /v1/me, files changed.
```

---

## Agent E1 — Estate Sync (enterprise only)

**Priority:** START FIRST  
**Owns:** `EstateSyncService`, GitHub installation repo listing, bulk `org_repos` upsert, bulk index jobs  
**Do not touch:** extension UI (E2), admin dashboard layout (E3), chat session (E4)

### Copy-paste into new chat

```
You are Agent E1 — Coop AI estate sync (Sourcegraph-style onboarding).

Read first:
- docs/enterprise-estate-tonight-build-plan.md § Agent E1
- src/server/githubAppApi.ts (handleCallback after installation)
- src/server/githubAppService.ts
- src/webhooks/handlers/githubWebhookHandler.ts (installation_repositories)
- src/server/orgStore.ts (upsertOrgRepo, getCodeHostInstallation)
- src/server/orgApi.ts (handleEnableLightning pattern)
- src/jobs/executors.ts (indexRepository)
- src/jobs/scheduler.ts (nightly index — reference only)

Goal: When a GitHub App is installed (enterprise org only), automatically index the full estate.

Implement:

## E1.1 — GitHubAppService.listInstallationRepositories(installationId)
- Paginate GET /installation/repositories from GitHub API
- Return normalized repoIds: github:owner/repo

## E1.2 — EstateSyncService
- New file: src/server/estateSyncService.ts
- syncInstallation(orgId, installationId): list repos → upsertOrgRepo → enqueue jobs via jobQueue
- Skip repos already indexing unless force flag
- Log counts: discovered, queued, skipped

## E1.3 — Wire triggers
- githubAppApi handleCallback: after upsertCodeHostInstallation, call estateSync ONLY if org.plan === 'enterprise'
- githubWebhookHandler installation_repositories (added) + installation (created): enterprise only
- POST /v1/orgs/estate/sync (enterprise admin only) for manual re-sync

## E1.4 — Plan gating (critical)
- Estate sync and auto lightning_enabled=true: **enterprise only**
- Pro orgs: NEVER auto-index all installation repos; Pro uses Agent P1 manual picker only
- Free: register repos optional; lightning_enabled=false

## E1.5 — Tests
- Unit test: estate sync skipped when plan=pro; runs when plan=enterprise

Verification:
- npm run lint
- npm run test — any new test script
- Local: mock installation callback OR integration test with recorded JSON fixture
- Document manual smoke in report:
  - Install GitHub App on test org
  - GET /v1/orgs/repos shows all repos
  - Jobs queue has INDEX_REPOSITORY per repo

Report: files changed, API endpoints added, manual smoke steps for Operator.
```

---

## Agent OPS — Production deploy verification

**Parallel with E1** if Railway deploy is active  
**Owns:** deploy docs accuracy, smoke scripts, env template gaps  
**Do not touch:** estate sync logic (E1)

### Copy-paste into new chat

```
You are Agent OPS — Coop AI production deploy verification.

Read:
- docs/deploy-railway.md
- docs/deploy-self-serve-pro.md
- docs/connect-integrations-production.md
- docker-compose.yml, railway.toml, scripts/run-migrations.mjs

Goal: Ensure operator can deploy tonight without agent blockers.

Implement / verify:
1. scripts/smoke-prod.sh (or extend existing) — curls /health, /v1/me with bearer, optional /graph search
2. .env.backend.example — complete checklist for Railway Phase 1 + Phase 2 vars (ZOEKT_URL, worker)
3. docs/deploy-railway.md — add explicit "enable estate sync" note pointing to E1 endpoint
4. Fix any doc drift (migration count, COOP_REQUIRE_API_AUTH, CORS origins)

Do NOT paste real secrets. Do not commit .env.backend.

Verification: npm run lint; run smoke script against localhost if docker up.

Report: operator checklist with exact Railway variable names and success signals.
```

---

## Agent E2 — Search scope (Pro: indexed | Enterprise: org)

**Start after:** P1 cap + repo list exist  
**Owns:** `lightningSearch` scope modes, graph API, extension defaults by plan  
**Do not touch:** P1 onboarding UI copy (P1), estate sync (E1)

### Copy-paste into new chat

```
You are Agent E2 — Coop AI search scope: Pro "indexed" vs Enterprise "org".

Read: docs/enterprise-estate-tonight-build-plan.md § Aligned decisions + Agent E2
Read: src/indexing/lightningSearch.ts, webhookServer.ts graph route, SettingsDetailViews.tsx

Implement:

## E2.1 — lightningSearch scope modes
- scope=repo → single repoId (active repo)
- scope=indexed → all lightning_enabled repos for org (Pro: ≤3; Enterprise: subset or all)
- scope=org → all lightning_enabled repos (enterprise default; same as indexed when estate full)
- scope=collection → existing collectionId path (advanced / team filters)

## E2.2 — Graph API + clients
- GET /graph/:repoId/search?scope=indexed|org&pattern=...
- CoopBackendClient.graphSearch(..., { scope })

## E2.3 — Extension defaults by plan (from /v1/me)
- Pro + 0 indexed: scope repo; show onboarding (P1)
- Pro + 2+ indexed: default scope indexed
- Enterprise: default scope org

Settings UI:
- Pro: Active repo | Deep-Indexed Repos | Collection
- Enterprise: Active repo | All Deep-Indexed Repos (org) | Collection

Verification: 2 Pro indexed repos, one search hits both.

Report: query params, default logic per plan.
```

---

## Agent E3 — Admin indexing dashboard

**Parallel with E2**  
**Owns:** admin UI for org repo index status, bulk actions  
**Do not touch:** lightningSearch core (E2), CoopChatSession (E4)

### Copy-paste into new chat

```
You are Agent E3 — Coop AI admin indexing dashboard.

Read:
- admin/src/app/(admin)/collections/page.tsx (pattern)
- admin/src/lib/coopApi.ts
- src/server/orgApi.ts GET /v1/orgs/repos
- docs/enterprise-estate-tonight-build-plan.md

Goal: Org admin sees estate indexing progress (Sourcegraph-style "repos syncing").

Implement:

## E3.1 — Admin page /indexing (or expand /collections)
- Table: repoId, lightning_enabled, index_status, last_indexed_at, error, last_job_id
- Summary cards: total repos, ready, indexing, error
- Poll every 10s or manual refresh

## E3.2 — Actions (wire to APIs)
- "Sync from GitHub" → POST /v1/orgs/estate/sync (E1)
- "Reindex repo" → POST /v1/orgs/repos/:repoId/lightning/enable
- "Enable all" / "Disable all" — only if E1 didn't add; else skip

## E3.3 — Sidebar link + coopApi methods

Verification:
- npm run lint
- admin dev server shows repos after E1 sync

Report: route path, screenshots description, API dependencies on E1.
```

---

## Agent E4 — Chat + blast radius (indexed / org scope)

**Start after:** E2 scope modes work  
**Owns:** CoopChatSession, hybridQuery, quick actions, blast radius context  
**Do not touch:** estate sync (E1), admin UI (E3)

### Copy-paste into new chat

```
You are Agent E4 — Wire org-wide scope into chat and blast radius.

Read:
- src/chat/CoopChatSession.ts (buildRepoId, resolveSearchCollectionId, fetchContextRequest)
- src/indexing/hybridQuery.ts (dependencies enrichment)
- src/indexing/cloudIndexBackend.ts (dependents)
- src/prompts/quickActionPrompts.ts (blast-radius)
- docs/enterprise-estate-tonight-build-plan.md

Goal: When searchScope is indexed (Pro) or org (Enterprise), chat @-mentions and blast radius use that scope — not active repo only.

Implement E4.1 resolveSearchScope() supporting repo | indexed | org | collection.
Wire @ picker and hybridQuery dependencies to indexed/org scope.

Report: files changed; manual smoke steps.
```

---

## Agent M — MCP server (Phase 2 — after E1 + E2)

**Enterprise only.** Exposes code graph to Cursor / Claude / other MCP clients.

### Copy-paste into new chat

```
You are Agent M — Coop AI MCP server (Enterprise only).

Prerequisites: E1 estate index + E2 org search scope shipped.

Read: docs/enterprise-estate-tonight-build-plan.md, src/indexing/lightningSearch.ts, src/api/graphQuery.ts

Implement:
- src/mcp/server.ts — MCP transport (HTTP/SSE on API host, e.g. /mcp)
- Auth: enterprise plan + org API key; reject pro/free
- Tools: search_code (lightningSearch scope=org), find_symbol, list_repos, get_dependents, index_status
- Each tool returns repoId:path:line citations
- Audit: usage_events eventType mcp.tool_call
- docs/mcp-enterprise.md — Cursor connection steps

Do not duplicate Pro indexed scope — MCP is enterprise upsell only.

Report: tool list, auth gate, verify with MCP client.
```

---

## Agent E5 — DEPRECATED

Use **Agent M** (MCP) for external agents. Coop extension uses E2/E4 scoped search directly.

---

## Merge order (when agents finish)

```text
1. P1 (Pro onboarding + cap)  → merge first
2. E1 (estate sync, enterprise only)
3. E2 (indexed vs org scope)
4. E3 (admin UI) — parallel E2
5. E4 (chat/blast scope)
6. M (MCP) — after E1+E2 in prod
7. OPS — anytime
```

**Conflict hotspots:** `orgApi.ts`, `webhookServer.ts`, `CoopChatSession.ts`, `lightningSearch.ts` — only one agent per file group.

---

## Tonight verification script (all agents done)

### Terminal

```bash
# Health
curl -s http://localhost:8787/health

# Org repos (replace TOKEN and ORG via your admin key)
curl -s -H "Authorization: Bearer $COOP_API_TOKEN" http://localhost:8787/v1/orgs/repos | jq '.repos | length'

# Org-wide search (after E2)
curl -s -H "Authorization: Bearer $COOP_API_TOKEN" \
  "http://localhost:8787/graph/github%3Aowner%2Frepo/search?scope=org&pattern=validate" | jq .

# Estate sync manual trigger (after E1)
curl -s -X POST -H "Authorization: Bearer $COOP_API_TOKEN" \
  http://localhost:8787/v1/orgs/estate/sync | jq .
```

### Extension UI — Pro smoke

1. New Pro user → Lightning panel shows onboarding checklist
2. Enable 3 repos → 4th shows upgrade message
3. Settings → **Deep-Indexed Repos** → @ picker hits all 3

### Extension UI — Enterprise smoke

1. Install GitHub App → estate sync queues all repos
2. Settings → **All Deep-Indexed Repos** (org)
3. Admin → Indexing dashboard

---

## Phase roadmap

| Phase | Agents | Outcome |
|-------|--------|---------|
| **1** | P1, E2, E4 | Pro self-serve: pick 3 repos, cross-repo within them |
| **2** | E1, E3, OPS Phase 2 | Enterprise estate index + admin visibility |
| **3** | M | Enterprise MCP for external coding agents |
| **4** | — | Pricing copy, ACLs, incremental reindex |

---

## Quick reference: agent → primary files

| Agent | Primary files |
|-------|----------------|
| **P1** | `LightningModePanel.tsx`, `orgApi.ts`, `orgStore.ts`, `SettingsDetailViews.tsx` |
| E1 | `estateSyncService.ts`, `githubAppApi.ts`, `githubWebhookHandler.ts` |
| E2 | `lightningSearch.ts`, `webhookServer.ts`, `CoopBackendClient.ts` |
| E3 | `admin/.../indexing/` |
| E4 | `CoopChatSession.ts`, `hybridQuery.ts` |
| **M** | `src/mcp/` (new), `docs/mcp-enterprise.md` |
| OPS | `deploy-railway.md`, `smoke-prod.sh` |
