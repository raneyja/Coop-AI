# Integration scope governance — cloud agent runbook

**Goal:** Security teams can approve Coop because admins define **allowlists** — connect OAuth once, then configure what the model may search.

**Monitor while away:** [cursor.com/agents](https://cursor.com/agents) (web/mobile) or GitHub PR notifications.

---

## Single Cloud Agent — copy everything below this line

**Do this now:**
1. **Cursor** → New Agent chat → switch **Local** → **Cloud**
2. Select branch `feat/integration-scope-governance` and repo `raneyja/Coop-AI`
3. Copy the entire fenced block below → paste → send
4. Close laptop; check [cursor.com/agents](https://cursor.com/agents) on your phone

```
You are a single autonomous Cloud Agent executing ALL phases of integration scope governance for Coop AI. Work sequentially — do not stop between phases. Run on CLOUD only (not local).

## Repo & branch
- GitHub: raneyja/Coop-AI
- Branch: feat/integration-scope-governance (already pushed)
- Do NOT read or commit .env.backend
- Follow AGENTS.md and .cursor/rules/webview-ui.mdc for admin UI
- Minimize scope — no drive-by refactors
- Commit your work to feat/integration-scope-governance as you go
- Open ONE pull request at the end (not four separate PRs)

---

## PHASE 1 — Benchmark (docs only)

Read: docs/admin-portal-production-plan.md (Phase 2), docs/enterprise-integration-onboarding.md

Research how enterprise SaaS products let admins scope third-party data access AFTER OAuth connect. Cover:
- Slack (Enterprise Grid channel allowlists, app scopes)
- Microsoft Teams / Graph (resource-specific consent)
- Notion (page-level OAuth)
- Atlassian (Jira projects, Confluence spaces)
- Google Workspace (Drive shared drives / folders)
- GitHub (App install repo selection)

Write docs/integration-scope-benchmark.md with:
1. Summary table: product | connect model | admin scope model | default posture
2. Recommended pattern for Coop (default-deny allowlist + search-time enforcement)
3. Security narrative bullets for sales/security review
4. Phased rollout (Slack first, then Jira/Confluence, Notion, Google)

Commit when done. Continue to Phase 2.

---

## PHASE 2 — Audit current Coop orchestration (docs only)

Read and trace:
- docs/enterprise-integration-onboarding.md
- src/context/integrationChatEnrichment.ts
- src/context/slackContext.ts, jiraContext.ts, confluenceContext.ts, notionContext.ts, googleDocsContext.ts
- src/server/integrationApi.ts, adminIntegrationsApi.ts, adminIntegrationTest.ts
- admin/src/app/(admin)/integrations/page.tsx, admin/src/components/IntegrationCard.tsx
- migrations/012_org_integration_connections.sql

Write docs/integration-scope-audit.md with:
1. Flow: OAuth connect → token storage → context fetch → chat
2. Per-provider table: OAuth scopes, query API, filtering today, gap vs allowlist
3. Exact files/functions to change (single resolveIntegrationScope enforcement hook)
4. Proposed DB schema (org_integration_policies or metadata JSONB)
5. Admin API endpoints: GET/PUT scope, GET resources for picker
6. Risk notes (Slack search:read, Google drive.readonly, etc.)

Use Phase 1 benchmark to inform recommendations. Commit. Continue to Phase 3.

---

## PHASE 3 — Build implementation

Read your Phase 1 + 2 docs before writing code.

Implement Phase A (foundation) + Phase B (Slack) only:

### Backend
1. Migration: org_integration_policies (org_id, provider, policy JSONB, updated_at) — or extend metadata if cleaner
2. GET/PUT /v1/admin/integrations/:provider/scope
3. GET /v1/admin/integrations/:provider/resources (Slack channel list for picker)
4. resolveIntegrationScope(orgId, provider) — call from fetchSlackSearchContext before vendor API
5. Enterprise default-deny: connected but no policy → empty context (no global Slack search)
6. Audit: admin.integration.scope.updated
7. Wire admin test endpoint to respect scope where applicable

### Admin UI (integrations page)
1. Integration card states: Connected | Scope required | Active
2. "Manage access" panel — Slack channel multi-select with search/browse
3. Save scope → show summary ("N channels selected")
4. Test button validates scoped access
5. Copy explaining: "Coop searches only what you select — not your entire workspace"
6. Jira/Confluence/Notion/Google: show "Scope configuration coming soon" stub if not implementing yet

Follow patterns in adminIntegrationsApi.ts, IntegrationCard.tsx. Commit. Continue to Phase 4.

---

## PHASE 4 — Test, fix, deliver

1. npm run lint — fix any errors you introduced
2. npm test — run any new/changed server tests; add minimal tests for resolveIntegrationScope if missing
3. cd admin && npm run build — fix failures
4. Write docs/integration-scope-smoke-test.md with manual checklist:
   - Admin connects Slack
   - Manage access → select channels → save
   - Test returns success for scoped channels
   - Enterprise org without scope gets no Slack context
5. Fix any failures from steps 1–3 (minimal diffs only)
6. Push all commits to feat/integration-scope-governance
7. Open PR titled: "feat: integration scope governance (Slack + docs)"

---

## Final report (required in PR description)

- Files changed (grouped by phase)
- Architecture summary (schema, enforcement hook, admin UX)
- Verification results (lint/build/test pass or fail)
- Manual smoke steps for operator at localhost:3002
- Follow-ups for Phase C (Jira, Confluence, Notion, Google)

Do not ask for confirmation between phases. Execute all four phases autonomously.
```

---

## Multi-agent option (four separate Cloud chats)

Use the sections below if you prefer parallel agents instead of one long run.

Run four **Cloud Agents** to design and ship admin-controlled integration scoping (Slack channels, Jira projects, Confluence spaces, etc.).

---

## Before you leave (5 minutes)

### 1. Terminal — push a working branch

Cloud agents clone from GitHub. Unpushed local work is invisible to them.

```bash
cd "/Users/jonraney/Desktop/Coop AI"
git checkout -b feat/integration-scope-governance
git push -u origin feat/integration-scope-governance
```

**Success:** Branch visible on GitHub.

### 2. Browser — confirm Cloud Agents access

- [cursor.com/agents](https://cursor.com/agents) loads and shows your repo
- Cursor **Pro/Business** plan with Cloud Agents enabled

### 3. Optional — cloud agent secrets (for Agent 4 tests)

In **Cursor Dashboard → Cloud Agents → Secrets** (or repo environment settings), add only what tests need:

| Secret | Used for |
|--------|----------|
| `DATABASE_URL` | Local-style postgres in cloud VM (if you configure startup) |
| `CURSOR_API_KEY` | Only if Agent 4 uses SDK scripts |

Most verification for Agents 1–3 is docs + lint/build. Agent 4 may need `docker compose` in the cloud VM — see [Cloud agent setup](https://cursor.com/docs/cloud-agent/setup).

---

## How Cloud Agents work here

| | Local agent | Cloud agent |
|---|-------------|-------------|
| Runs on | Your Mac | Cursor VM |
| Laptop closed | Stops | **Continues** |
| Select | Agent dropdown → Local | Agent dropdown → **Cloud** |
| Output | Local files | Branch + PR on GitHub |

**Rule:** Always pick **Cloud** in the agent picker (or **Build in Cloud** after Plan mode).

---

## Run order

```text
T+0     Agent 1 (benchmark)  ──┐
T+0     Agent 2 (audit)      ──┼── parallel
                               │
T+45m   Agent 3 (build)      ◄── after 1 + 2 PRs merged OR both pushed to same branch
T+90m   Agent 4 (test)       ◄── after Agent 3 PR
```

Agents 1 and 2 can start **at the same time** on the same branch — they touch different files (`docs/` vs audit notes).

Agent 3 should **read** Agent 1's design doc and Agent 2's audit before coding.

Agent 4 runs lint/build/tests and smoke-checks the admin Integrations UI.

---

## Agent 1 — Benchmark how other tools scope access

**Start:** T+0 · **Owns:** `docs/integration-scope-benchmark.md` · **Do not touch:** application code

### Copy-paste into new **Cloud** agent chat

```
You are Agent 1 — integration scope benchmark research.

Repo: feat/integration-scope-governance branch on Coop AI
Runtime: CLOUD (not local)

Read first:
- docs/admin-portal-production-plan.md (Phase 2 — Enterprise governance)
- docs/enterprise-integration-onboarding.md

Task: Research how enterprise SaaS products let admins scope third-party data access AFTER OAuth connect. Focus on patterns security teams accept.

Cover at least:
- Slack (Enterprise Grid channel allowlists, SCIM, app scopes)
- Microsoft Teams / Graph (resource-specific consent, channel scope)
- Notion (page-level OAuth vs workspace)
- Atlassian (Jira projects, Confluence spaces)
- Google Workspace (Drive shared drives / folder scope)
- GitHub (App installation repo selection vs OAuth)

Deliverable: docs/integration-scope-benchmark.md with:
1. Summary table (product | connect model | admin scope model | default posture)
2. Recommended pattern for Coop (default-deny allowlist vs search-time filter)
3. Security narrative bullets for sales/security review
4. Phased rollout recommendation (Slack first, then Jira/Confluence, etc.)

Do NOT implement code. Commit to feat/integration-scope-governance and open a PR titled "docs: integration scope benchmark".

Verification: PR contains the doc only; no unrelated files.
```

---

## Agent 2 — Audit current Coop orchestration

**Start:** T+0 (parallel with Agent 1) · **Owns:** `docs/integration-scope-audit.md` · **Do not touch:** feature implementation

### Copy-paste into new **Cloud** agent chat

```
You are Agent 2 — integration scope codebase audit.

Repo: feat/integration-scope-governance branch on Coop AI
Runtime: CLOUD

Read first:
- docs/enterprise-integration-onboarding.md
- src/context/integrationChatEnrichment.ts
- src/context/slackContext.ts, jiraContext.ts, confluenceContext.ts, notionContext.ts, googleDocsContext.ts
- src/server/integrationApi.ts, adminIntegrationsApi.ts
- admin/src/app/(admin)/integrations/page.tsx
- admin/src/components/IntegrationCard.tsx
- migrations/012_org_integration_connections.sql

Task: Document how Coop currently orchestrates integration data access end-to-end.

Deliverable: docs/integration-scope-audit.md with:
1. Flow diagram (OAuth connect → token storage → context fetch → chat)
2. Per-provider table: OAuth scopes granted, query API used, any filtering today, gap vs admin allowlist
3. Exact files/functions to change for enforcement (single resolveIntegrationScope hook)
4. Proposed DB schema (org_integration_policies or metadata JSONB shape)
5. Admin API endpoints needed (GET/PUT scope, GET list resources for picker)
6. Risk notes (Slack search:read breadth, Google drive.readonly, etc.)

Do NOT implement code yet. Commit and open PR "docs: integration scope audit".

Verification: doc references real file paths; no code changes except doc.
```

---

## Agent 3 — Build implementation

**Start:** T+45m · **After:** Agent 1 + 2 docs exist on branch (merge their PRs or rebase)

### Copy-paste into new **Cloud** agent chat

```
You are Agent 3 — integration scope governance implementation.

Repo: feat/integration-scope-governance branch on Coop AI
Runtime: CLOUD

Read first (required):
- docs/integration-scope-benchmark.md
- docs/integration-scope-audit.md
- AGENTS.md, .cursor/rules/webview-ui.mdc (admin UI only)

Implement Phase A + Slack (Phase B) from the audit:

Backend:
1. Migration: org_integration_policies (org_id, provider, policy JSONB, updated_at)
2. GET/PUT /v1/admin/integrations/:provider/scope
3. GET /v1/admin/integrations/:provider/resources (list channels for Slack picker)
4. resolveIntegrationScope(orgId, provider) — used by fetchSlackSearchContext
5. Enterprise default-deny: no policy configured → return empty context (not global search)
6. Audit events: admin.integration.scope.updated

Admin UI (integrations page):
1. Integration card shows: Connected | Scope required | Active
2. "Manage access" expands Slack channel multi-select
3. Save scope, show summary ("N channels selected")
4. Test button validates scoped access

Follow existing patterns in adminIntegrationsApi.ts, IntegrationCard.tsx.
Minimize scope — Slack first; stub UI for Jira/Confluence as "Coming soon" if needed.

Verification:
- npm run lint
- npm run build (admin)
- Relevant server tests if added
- Open PR "feat: integration scope governance (Slack)"

Do not commit .env.backend. Report files changed and manual smoke steps.
```

---

## Agent 4 — Test and smoke

**Start:** After Agent 3 PR is up · **Owns:** test fixes only · **Do not touch:** product design

### Copy-paste into new **Cloud** agent chat

```
You are Agent 4 — integration scope QA.

Repo: feat/integration-scope-governance branch (include Agent 3's commits)
Runtime: CLOUD

Read Agent 3's PR description and changed files.

Task:
1. Run npm run lint
2. Run npm test for any new/changed server tests
3. cd admin && npm run build
4. Fix any failures Agent 3 introduced (minimal diffs only)
5. Add docs/integration-scope-smoke-test.md with manual checklist:
   - Admin connects Slack
   - Manage access → select channels → save
   - Verify scoped Test returns success
   - Verify unscoped enterprise org gets no Slack context (or document limitation)
6. If docker compose is available in cloud VM, run targeted API curl tests; otherwise document local smoke steps for the operator

Open PR "test: integration scope smoke" OR push fixes to Agent 3's branch with comment.

Report: pass/fail per check, blockers for merge.
```

---

## While driving — check progress

1. **Browser →** [cursor.com/agents](https://cursor.com/agents) — agent status, logs, PR links
2. **GitHub →** PRs on `feat/integration-scope-governance`
3. **Merge order:** Agent 1 PR → Agent 2 PR → rebase Agent 3 → Agent 4 fixes → review combined PR

---

## Alternative: SDK orchestrator (advanced)

If you want one script to chain agents programmatically:

```typescript
import { Agent } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY!;
const repo = "https://github.com/YOUR_ORG/coop-ai"; // your remote
const branch = "feat/integration-scope-governance";

for (const prompt of [AGENT_1_PROMPT, AGENT_2_PROMPT, /* ... */]) {
  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: "composer-2.5" },
    cloud: {
      repos: [{ url: repo, ref: branch }],
      autoCreatePR: true,
    },
  });
  if (result.status !== "finished") throw new Error(result.status);
}
```

Requires `CURSOR_API_KEY` from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations). Run from CI or a always-on machine — not from a closing laptop unless the script itself runs in cloud CI.

---

## Operator checklist when back at desk

1. Review Agent 1 benchmark + Agent 2 audit docs
2. Review Agent 3 PR diff (schema, enforcement hook, admin UI)
3. **Terminal:** `./scripts/dev-admin-portal.sh` + test Manage access on `/integrations`
4. Merge to main when smoke passes
