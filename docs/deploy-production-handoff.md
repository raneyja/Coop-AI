# Production handoff — launch with Deep-Code Graph

**Updated:** June 15, 2026  
**Launch definition:** Public launch **after** Pro (3-repo) + Enterprise (estate) indexing works in production — not integrations-only.

**Product priority (confirmed):**
- **Pro:** Self-serve **Deep-Code Graph** on up to **3 repos per seat** + **Coop-Search** across them
- **Enterprise:** **Estate-wide** code graph (full GitHub org) + admin visibility (+ MCP later)

**Spec:** [enterprise-estate-tonight-build-plan.md](./enterprise-estate-tonight-build-plan.md)

---

## What’s already done

| Area | Status |
|------|--------|
| API + Postgres on Railway (`api.coop-ai.dev`) | Done |
| All integrations OAuth (GitHub → Teams) | Done |
| Stripe test checkout + admin portal | Done |
| Test 3 Pro org validated end-to-end | Done |

---

## Launch critical path (order matters)

```text
1. YOU  — Railway Phase 2 (worker + Zoekt)     ← blocks all prod indexing
2. AGENTS — P1 Pro cap + repo picker + copy
3. AGENTS — E2 search scope (indexed / org)
4. AGENTS — E4 chat + blast use scope
5. YOU  — Pro smoke on Test 3 (3 repos, Coop-Search)
6. AGENTS — E1 estate sync (enterprise only)
7. AGENTS — E3 admin indexing dashboard
8. YOU  — Enterprise smoke (GitHub App + estate org)
9. YOU  — Merge PRs + extension rebuild
10. YOU — Stripe live (after steps 1–5 pass)
11. LATER — MCP (Agent M), Marketplace publish
```

**Do not flip Stripe live** until Test 3 can deep-index at least one repo and Coop-Search returns hits in prod.

---

## Summary: you vs agents

| # | Work | Owner | Doc / agent |
|---|------|-------|-------------|
| 0 | Railway worker + Zoekt + volume | **You** | [deploy-railway-phase2-lightning.md](./deploy-railway-phase2-lightning.md) |
| 1 | Pro 3-repo cap + picker + onboarding copy | **Agents P1** | [enterprise-estate-tonight-build-plan.md](./enterprise-estate-tonight-build-plan.md) § P1 |
| 2 | Search scope `indexed` / `org` | **Agents E2** | § E2 |
| 3 | Chat / blast / @ picker use scope | **Agents E4** | § E4 |
| 4 | Estate sync (enterprise only) | **Agents E1** | § E1 — needs `GITHUB_APP_*` |
| 5 | Admin indexing dashboard | **Agents E3** | § E3 |
| 6 | Smoke scripts + env template | **Agents OPS** | § OPS |
| 7 | GitHub/Teams UI fixes (local) | **Agents** → PR | Merge before P1 UI work |
| 8 | Stripe live | **You** | [deploy-stripe-live.md](./deploy-stripe-live.md) — **last** |
| 9 | MCP server | **Later** | § M |

---

# YOUR STEPS — detailed

---

## Step 0 — Browser — Railway Phase 2 (required first)

Without this, **no Deep-Code Graph in production**.

Follow [deploy-railway-phase2-lightning.md](./deploy-railway-phase2-lightning.md):

1. Create **Volume** `zoekt-indexes` at `/zoekt-indexes`
2. Add **coop-worker** — start `node dist/workerEntry.js`, same env as API, attach volume
3. Add **coop-zoekt** — start `zoekt-webserver -index /zoekt-indexes -listen 0.0.0.0:$PORT`, same volume
4. On **coop-api** → `ZOEKT_URL=http://<zoekt-private-host>:6070` → redeploy

**Success looks like:**

```bash
curl -s https://api.coop-ai.dev/health
# ok: true

# After enabling a repo (Step 5):
curl -s -H "Authorization: Bearer $KEY" \
  "https://api.coop-ai.dev/graph/github%3Aowner%2Frepo/search?pattern=main" 
# returns hits (not empty/error)
```

Also confirm Railway has **OpenAI** (or embedding provider) key if embeddings step is required — see [llm-provider-keys.md](./llm-provider-keys.md).

---

## Step 1 — Agents — P1 + E2 + E4 (Pro launch story)

Open agent chats from [enterprise-estate-tonight-build-plan.md](./enterprise-estate-tonight-build-plan.md):

| Order | Agent | Delivers |
|-------|-------|----------|
| 1 | **P1** | 3-repo/seat cap, Lightning panel repo picker, Deep-Code Graph copy, `/v1/me` limits |
| 2 | **E2** | `scope=indexed` for Pro, graph API + extension defaults |
| 3 | **E4** | Chat, @ picker, blast radius use indexed scope |

**Merge order:** P1 → E2 → E4 (see estate plan conflict hotspots).

**Pro works with current GitHub OAuth** (`GITHUB_OAUTH_*`) — no GitHub App required for Pro.

---

## Step 2 — Extension UI + Terminal — Pro smoke (Test 3)

After P1+E2+E4 merge and `npm run build:webview`:

1. **Extension Development Host** → sign in Test 3 `coop_…` key
2. **Tools → GitHub** → connected
3. Open **Deep-Code Graph** panel (Lightning panel — new copy)
4. Add repo 1 → enable indexing → wait **Ready**
5. Add repos 2 and 3 → enable → **Ready**
6. Attempt 4th → **upgrade to Enterprise** message (403)
7. **Workspace → Search scope → Deep-Indexed Repos**
8. Chat **@** picker or Coop-Search finds symbols across all 3 repos

**Success looks like:** 3 repos indexed in prod; cross-repo search works; 4th blocked.

---

## Step 3 — Agents — E1 + E3 (Enterprise launch story)

| Agent | Delivers |
|-------|----------|
| **E1** | `EstateSyncService`, auto-index on GitHub App install, `POST /v1/orgs/estate/sync` |
| **E3** | Admin `/indexing` dashboard — repos syncing, errors, reindex |

### Step 3a — Browser — Railway (GitHub App for Enterprise)

E1 **requires GitHub App**, not OAuth-only:

| Variable | Source |
|----------|--------|
| `GITHUB_APP_ID` | [github.com/settings/apps](https://github.com/settings/apps) |
| `GITHUB_APP_PRIVATE_KEY` | App settings → PEM |
| `GITHUB_APP_SLUG` | App slug |

Keep `GITHUB_OAUTH_*` for Pro self-serve Connect if desired — both can coexist.

### Step 3b — Terminal — enterprise test org

```bash
cd "/Users/jonraney/Desktop/Coop AI"
docker compose exec api node dist/admin-org.js create-org "Estate Test" enterprise
docker compose exec api node dist/admin-org.js create-api-key <orgId> primary
```

(Use Railway admin CLI or portal equivalent for prod org.)

### Step 3c — Browser — GitHub App install

Install GitHub App on a test org with multiple repos → estate sync queues all → admin **Indexing** shows progress.

**Success looks like:** `GET /v1/orgs/repos` lists entire estate; jobs complete; `scope=org` search hits all repos.

---

## Step 4 — Browser — merge PRs + Stripe live

Only after **Step 0 + Step 2** pass.

1. Merge GitHub/Teams UI PR + estate agent PRs
2. Redeploy Railway API if needed
3. Follow [deploy-stripe-live.md](./deploy-stripe-live.md)

**Success looks like:** New Pro customer can checkout → connect GitHub → pick 3 repos → Coop-Search works.

---

## Step 5 — Extension publish (when taking non-dev customers)

| Path | Surface |
|------|---------|
| VSIX | Terminal: `npm run package` |
| Marketplace | Browser: Microsoft Partner Center |

---

## Integration checklist

| Integration | Status |
|-------------|--------|
| GitHub | Done |
| Slack | Done |
| Jira + Confluence | Done |
| Notion | Done |
| Google Docs | Done |
| Microsoft Teams | Done |

---

## Indexing checklist (launch gate)

| Capability | Pro | Enterprise | Status |
|------------|-----|------------|--------|
| Railway worker + Zoekt | Required | Required | **You — Step 0** |
| Deep-index chosen repos (≤3/seat) | Yes | Yes (via estate) | **Agents P1** |
| Coop-Search across indexed repos | Yes | Yes | **Agents E2 + E4** |
| Estate auto-sync on GitHub App | No | Yes | **Agents E1** |
| Admin indexing dashboard | — | Yes | **Agents E3** |
| MCP external agents | No | Later | **Agent M** |

---

## Quick reference

- Estate build plan: [enterprise-estate-tonight-build-plan.md](./enterprise-estate-tonight-build-plan.md)
- Railway Phase 2: [deploy-railway-phase2-lightning.md](./deploy-railway-phase2-lightning.md)
- Stripe live (last): [deploy-stripe-live.md](./deploy-stripe-live.md)
- Integrations: [connect-integrations-production.md](./connect-integrations-production.md)
