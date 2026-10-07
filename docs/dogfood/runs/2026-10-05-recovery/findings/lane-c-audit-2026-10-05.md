# QA lane C — API, tenancy, quota, faults, integrations, billing, and surfaces

Date: 2026-10-05 America/Los_Angeles  
Result: **UNQUALIFIED — source FAILs plus live BLOCKED/NOT_RUN checks**

## C-SURF-002 — website billing proxy has an unsafe production fallback (FAIL, P1)

Evidence: `website/src/app/api/checkout/route.ts:3` and
`website/src/app/api/checkout-status/route.ts:3` resolve `COOP_API_BASE` to
`http://localhost:8787` when the variable is absent. The documented production
configuration in `docs/deploy-self-serve-pro.md:96-111` requires
`COOP_API_BASE=https://api.coop-ai.dev`, but this checkout cannot prove that the
Vercel Production environment contains it. If the variable is missing, deployed
checkout requests target the Vercel instance's loopback rather than the canonical
API. This is a source-level unsafe fallback, not proof that production is
currently misconfigured.

Minimal founder-only check: in the website Vercel Production environment, verify
the redacted value is the canonical API host, redeploy if it was changed, then
exercise `/pricing` → test checkout only with Stripe test mode. Do not use live
payment credentials.

## C-FAULT-002 — website billing routes do not convert network faults to controlled JSON (FAIL, P1)

Evidence: `website/src/app/api/checkout/route.ts:48-57` and
`website/src/app/api/checkout-status/route.ts:12-15` call `fetch()` without a
`try/catch`. They handle non-2xx responses, but DNS failure, connection refusal,
or timeout rejects the handler before its JSON error branch. The local
`fault-check` passed for the disposable proxy's 429/503/offline/pass modes, but
that test does not exercise these Next route handlers, so no graceful deployed
fault behavior is claimed.

Minimal retest: run the two route handlers in an isolated local harness with the
upstream unreachable and assert a bounded, non-secret JSON error response; then
repeat against a test deployment. No implementation change was made in this QA
lane.

## C-API-001 — canonical API and revision proof unavailable (BLOCKED, P0)

Evidence: `curl -sS -I --max-time 5 https://api.coop-ai.dev/health` exited 6
(`Could not resolve host`) on this environment. The same DNS failure occurred for
the marketing, admin, and ops hosts. No HTTP status, health body, request ID, or
deployed commit was observed. Handoff metadata names deployment
`fa74a66c-80d9-447f-9ff1-d4b94053dd2d` / source `c4a83a7`, while the checkout HEAD
is `bf8dc0d...`; matching them was not possible.

Founder-only blocker: from an authorized network, resolve the four canonical
hosts, capture redacted status/body/headers, and require the API health commit to
match the frozen candidate tuple before any live PASS.

## C-TEN-001 / C-QUOTA-001 — source controls present; boundary execution NOT_RUN

Static evidence supports production auth defaulting on, DB-backed plan checks,
suspended-org denial, org-scoped repo access, free rolling-window quota, paid
per-user meters, and org/provider integration scope (see
`evidence/lane-c-audit-2026-10-05.md`). The focused auth/quota/repo-access tests
could not run because local `tsx` is unavailable and `npx` did not complete in the
bounded window. The isolated compose sandbox was not started. Therefore tenant
isolation, free/paid exhaustion, revoked sessions, denied roles, and cross-tenant
repo grants are **NOT_RUN**, not PASS.

## C-FAULT-001 — controlled local fault classification (PASS, narrow)

`node scripts/dogfood-sandbox.mjs fault-check` exited 0 and reported PASS for
429, 503, offline, and pass modes. This validates only the disposable proxy's
fault injection and response expectations; it does not qualify upstream API,
Next route, extension, or production behavior.

## C-INT-001 — integrations and revocation (NOT_RUN)

Source paths model org/provider scope and encrypted credential storage, but this
lane did not connect, revoke, or query Slack, Jira/Confluence, Notion, Google
Docs, Teams, GitHub, GitLab, or Bitbucket credentials. No live scope, suspension,
revocation, or provider-error result is available.

## C-BILL-001 — billing/test-mode readiness (BLOCKED / NOT_RUN)

Billing source and test harnesses exist, and the API has explicit unavailable and
Stripe-error responses (`src/server/billing/billingApi.ts:203-289,390-438`). No
Stripe test credentials, webhook delivery, checkout session, entitlement
mutation, seat change, portal session, email, or payment was performed. Billing
cannot be promoted beyond source evidence without an authorized test-mode
fixture and candidate-matched API.

## C-SURF-001 — supported routes/config inventory (PASS, source-only)

Canonical source configuration points marketing to `https://coop-ai.dev`, API
clients to `https://api.coop-ai.dev`, admin to `https://admin.coop-ai.dev`, and
ops to `https://ops.coop-ai.dev`; `website/vercel.json:7-13` redirects `www` to
the apex. Website, admin, and ops route files are present, including pricing,
docs, auth, billing, integrations, repository access, indexing, and operator
customer routes. This is a source inventory only; deployment, authentication,
rendering, CORS, and backend connectivity remain NOT_RUN due to DNS blockage.

## Claim boundary

This lane does not claim production readiness, live tenant isolation, live quota
correctness, billing correctness, integration correctness, portal readiness, or
payment success. The recovery run remains **UNQUALIFIED**.

