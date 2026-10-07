# QA lane C — API, tenancy, integrations, billing, and canonical surfaces

Date: 2026-10-05 America/Los_Angeles  
Lane: C  
Mode: read-only source audit and safe unauthenticated API probe  
Overall lane result: **BLOCKED / NOT QUALIFIED**

## Candidate and scope

- Checkout: `/Users/jonraney/Coop-AI`
- Branch: `checkpoint/dogfood-2026-10-03`
- HEAD observed: `36cf801040cf6666c68f93c7cd579802a4ccec43`
- Production deployment named by handoff: `fa74a66c-80d9-447f-9ff1-d4b94053dd2d`, source `c4a83a7`.
- This lane did not build, package, deploy, change branches, change credentials, send messages, create grants, or perform payments.
- Historical logs and the handoff deployment identity were not promoted to a current live pass.

## Findings

### C-API-001 — production API readiness and revision proof are unavailable (BLOCKED, P0 evidence gap)

Observed commands and exits on 2026-10-05:

```text
curl -sS -D - https://api.coop-ai.dev/health -o /tmp/coop-health-body.txt
exit 1
curl: (6) Could not resolve host: api.coop-ai.dev

curl -sS -D - https://api.coop-ai.dev/v1/me -o /tmp/coop-me-body.txt
exit 1
curl: (6) Could not resolve host: api.coop-ai.dev
```

No HTTP status, response body, request ID, health payload, or deployed revision was observed. This proves only that the API was not DNS-resolvable from this QA environment at probe time; it does not distinguish DNS, network, or service state and is not by itself proof of a global outage.

Source evidence: `src/webhooks/webhookServer.ts:441-456` returns public health `{ ok: true, commit }`; `src/webhooks/webhookServer.ts:1013-1022` derives the commit from `COOP_BUILD_SHA`, `RAILWAY_GIT_COMMIT_SHA`, or `GIT_COMMIT_SHA`, otherwise returns `unknown`. Required retest: resolve the canonical hostname from an authorized environment, capture status/body/request ID, and require the returned commit to match the frozen candidate before any live API claim.

### C-TEN-001 — tenancy/auth/quota controls are present in source, but no live boundary pass

Source evidence inspected:

- `src/server/authMiddleware.ts` and `src/server/authMiddleware.test.ts`: auth context, org-plan checks, 403 plan denial, and principal identity distinctions.
- `src/server/planQuota.ts` and `src/server/planQuota.test.ts`: free rolling-window quota, token-to-credit conversion, usage event types, and request estimates.
- `src/server/operatorApi.test.ts`: org-admin sessions are rejected from operator routes; operator mutation role checks and audit behavior are covered in the harness.
- `src/server/indexedRepoQuota.test.ts`, `src/server/resolveAccessibleRepos.test.ts`, and `src/server/workspaceReposAccess.test.ts` are named repository/quota/access boundary checks.
- `scripts/dogfood-sandbox.mjs` defines an isolated smoke contract for 401 auth, org separation, member admin denial, cross-tenant grant denial, billing-unavailable behavior, logout revocation, and per-user quota isolation.

The listed test commands were started read-only but did not complete within 30 seconds and produced no result before being terminated. Each therefore remains `NOT_RUN` for this lane, not a pass. No sandbox compose stack was started by this lane, so the script’s synthetic results are not current evidence.

### C-BILL-001 — billing/Stripe flow is not qualified

Source evidence shows test-mode-oriented harnesses (`scripts/checkout-smoke-test.mjs`, `scripts/checkout-e2e-browser.mjs`) and billing tests under `src/server/billing/`, but this lane did not invoke them because they require mutable local services, Stripe test credentials, or payment-side effects. No real or test payment, webhook, checkout, entitlement mutation, seat change, or customer-portal action was performed. Billing remains `BLOCKED / NOT_RUN` pending an authorized test-mode fixture and candidate-matched API.

### C-INT-001 — integration scope and revocation are source-only evidence

`docs/integration-scope-benchmark.md` documents default-deny/resource-scoped integration expectations. `admin/src/lib/coopApi.ts` models integration status, reconnect/scope status, organization suspension, quota, and billing state. This lane did not connect, revoke, or live-test Slack, Jira, Teams, Confluence, Notion, Google Docs, GitHub, or Atlassian credentials. Integration isolation and revoked/denied-scope behavior remain `NOT_RUN`.

### C-SURF-001 — canonical surface routes/configuration are present; deployment behavior unverified

Source inventory confirms:

- Marketing routes: `website/src/app/page.tsx`, `pricing/page.tsx`, `docs/page.tsx`, `docs/[slug]/page.tsx`, `integrations/page.tsx`; canonical config in `website/src/lib/site.config.ts` and `src/config/siteConfig.ts` uses `https://coop-ai.dev`.
- `website/vercel.json` redirects `www.coop-ai.dev` to the apex domain.
- Admin routes include authenticated dashboard, billing, users, integrations, indexing, repository access, settings, and API-key surfaces under `admin/src/app/(admin)/`.
- Ops routes include login, customers, customer detail/users, and activity under `ops/src/app/` and use `https://api.coop-ai.dev` / `https://ops.coop-ai.dev` defaults in `ops/src/lib/serverCoopApi.ts`.
- Operator role helpers in `ops/src/lib/operatorRbac.ts` distinguish support, billing, and super-admin mutations.

No browser or live portal check was performed. Route existence and canonical constants do not prove deployed routes, authentication, rendering, CORS, or backend connectivity. Surface qualification remains `NOT_RUN`.

## Exact commands and evidence

Read-only commands completed successfully:

```text
pwd && rg --files -g 'AGENTS.md' -g '*recovery*' -g 'docs/dogfood/runs/2026-10-05-recovery/**'
exit 0

git status --short --branch
node -e "const p=require('./package.json'); console.log(JSON.stringify(p.scripts,null,2))"
rg -n "health|ready|revision|commit|build|deployment|stripe|quota|org_suspended|require.*Auth|operator" src/server src/webhooks scripts admin/src ops/src website/src
exit 0

rg --files website/src/app admin/src ops/src/app
rg -n "NEXT_PUBLIC|API_BASE|coop-ai\\.dev|admin\\.coop-ai\\.dev|ops\\.coop-ai\\.dev|/pricing|/docs" website admin ops
exit 0
```

The source inspection was read-only. The eight targeted test processes (`authMiddleware`, `planQuota`, `billingApi`, `indexedRepoQuota`, `resolveAccessibleRepos`, `workspaceReposAccess`, `operatorApi`, and `operatorAuthConfig`) were terminated after no output or completion within 30 seconds; record as `NOT_RUN`, not `PASS`.

## Required next actions

1. Re-run `/health` and `/v1/me` from a network where `api.coop-ai.dev` resolves; save redacted headers/body and request ID.
2. Verify returned health `commit` against the frozen extension/webview/VSIX/backend candidate tuple.
3. Run the isolated sandbox boundary harness only after confirming its local stack identity; preserve exits and logs.
4. Obtain explicit test-mode Stripe/integration fixtures before exercising billing or connection mutations.
5. Run deployed website/admin/ops route checks against canonical hosts; keep all browser/live checks separate from source-level route inventory.

## Claim discipline

This lane provides source-path evidence and a reproducible DNS-resolution blocker. It does not establish launch readiness, live API availability, tenancy isolation in production, billing correctness, integration correctness, or portal behavior.
