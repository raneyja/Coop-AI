# Lane C audit evidence — 2026-10-05

This is read-only evidence from the preserved dirty checkout. It does not certify
production, live API, billing, integration, or portal readiness.

## Candidate/deployment identity

- Checkout: `/Users/jonraney/Coop-AI`
- Observed HEAD: `bf8dc0dc25cf998cd68b556e0dbede7af7bc812c`
- Remote: `https://github.com/raneyja/Coop-AI.git`
- Handoff deployment metadata: Railway deployment `fa74a66c-80d9-447f-9ff1-d4b94053dd2d`, source label `c4a83a7`; no proof that it matches this checkout was available.

## Safe checks

| Check | Result | Evidence |
|---|---|---|
| Controlled fault proxy | PASS | `node scripts/dogfood-sandbox.mjs fault-check` exited 0; proxy observed expected 429, 503, offline, and pass modes. This is a local proxy check only. |
| TypeScript focused tests | NOT_RUN | `node_modules/.bin/tsx` is absent. `npx tsx` attempts for auth, quota, repo access, integration scope, faults, billing, and operator tests produced no output within 30 seconds and were stopped with exit 130. |
| Public canonical host probes | BLOCKED | `curl -sS -I --max-time 5` for `coop-ai.dev`, `admin.coop-ai.dev`, `ops.coop-ai.dev`, and `api.coop-ai.dev/health` all exited 6: host could not be resolved from this environment. |

## Static boundary evidence

- `src/server/serverConfig.ts:16-32` forces `requireApiAuth: true` for `NODE_ENV=production` and ignores an explicit production `COOP_REQUIRE_API_AUTH=false`.
- `src/server/authMiddleware.ts:82-129` resolves org API keys and SSO sessions before the local-development bearer fallback; `:142-176` reloads org plan from the store for non-legacy auth; `:225-259` gates org-admin/integration installation roles.
- `src/server/resolveAccessibleRepos.ts:28-60` scopes repo listings by `orgId`, indexed repo state, admin access mode, and user grant IDs; API-key principals receive no user-grant repos in grant-only mode.
- `src/server/resolveIntegrationScope.ts:55-257` keys scope policy reads by `orgId` and provider and fail-closes gated plans when a connection or allowlist is absent.
- `src/jobs/errorHandling.ts:44-83` classifies permanent/cancelled failures as non-retryable and redacts common Git/API token forms before persistence/return.
- `scripts/dogfood-sandbox.mjs:19-56` defines local checks for unauthenticated access, tenant separation, member denial, cross-tenant grants, billing-unavailable behavior, and logout revocation; the stack was not started by this lane.

