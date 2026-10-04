# Disposable dogfood environment

This local environment supplies isolated organizations, free and paid demo accounts, authentication, quota boundaries, access-denial fixtures, and controlled API faults. It is running independently of production. Model requests are available through a protected, runtime-only provider configuration. Genuine indexed repositories, connected collaboration services, and a Stripe test account remain separate prerequisites.

## Open the environment

Open **http://127.0.0.1:13002/login** in a browser. The API is **http://127.0.0.1:28787**. All demo accounts use the local-only password `DemoPassword12!`:

- `free-admin@demo.local`: Free organization administrator.
- `pro-admin@demo.local`: Pro organization administrator.
- `pro-member@demo.local`: Member in the same Pro organization.
- `enterprise-admin@demo.local`: Separate Enterprise organization administrator.
- `repo-access-admin@demo.local`: Repository access fixture administrator.
- `repo-access-dev@demo.local`: Member in that access fixture organization.

The repository catalog seeded by the access fixture contains synthetic IDs. A ready status in those rows is an access-control fixture, not proof of indexed source or code-host connectivity. Paid plan rows are synthetic entitlements, not real subscriptions.

## Recreate and verify

Run these commands from the **repository terminal**. Docker must be running, the local `coop-ai-api` image must exist, and `dist/admin-org.js` plus the backend bundle must already be built. The compose file mounts the current `dist` directory read-only; record its hashes again after a rebuild.

```sh
node scripts/dogfood-sandbox.mjs setup
node scripts/dogfood-sandbox.mjs smoke
node scripts/dogfood-sandbox.mjs quota-smoke
node scripts/dogfood-sandbox.mjs model-smoke
node scripts/dogfood-sandbox.mjs fault-check
```

`setup` runs migrations and replaces only the named demo tenants in this separate database. It resets their sessions and fixture data. The compose project is `coop-dogfood-20261003`; its database volume is `coop-dogfood-20261003_dogfood_db`. It reads no production environment file. PostgreSQL, API, and admin ports bind to loopback.

To restart the **admin terminal**, run from `admin/`:

```sh
COOP_API_BASE=http://127.0.0.1:28787 NEXT_PUBLIC_COOP_API_BASE=http://127.0.0.1:28787 node node_modules/next/dist/bin/next dev -p 13002 -H 127.0.0.1
```

The seed CLI prints generic default URLs; use the local URLs above instead.

For the production-build local admin server, set both API variables while building as well as starting. Next.js embeds `NEXT_PUBLIC_COOP_API_BASE` at build time; setting it only when starting cannot change an existing browser bundle. From `admin/`:

```sh
COOP_API_BASE=http://127.0.0.1:28787 NEXT_PUBLIC_COOP_API_BASE=http://127.0.0.1:28787 npm run build
COOP_API_BASE=http://127.0.0.1:28787 NEXT_PUBLIC_COOP_API_BASE=http://127.0.0.1:28787 node node_modules/next/dist/bin/next start -p 13002 -H 127.0.0.1
```

Stop the local dev server before using this alternative. The current disposable admin server uses this verified build.

## Controlled faults

Start `node scripts/dogfood-sandbox.mjs faults` in a separate repository terminal. The proxy listens at **http://127.0.0.1:28788**. Select a mode with a loopback POST:

```sh
curl -X POST http://127.0.0.1:28788/__dogfood/mode/429
curl -X POST http://127.0.0.1:28788/__dogfood/mode/503
curl -X POST http://127.0.0.1:28788/__dogfood/mode/offline
curl -X POST http://127.0.0.1:28788/__dogfood/mode/pass
```

`fault-check` starts its own temporary proxy, verifies all four modes, and closes it. Stop a running manual proxy before invoking that check.

## Verified scope and remaining prerequisites

The API smoke verifies login identities, plans and roles, organization separation, denied member-admin access, denied cross-tenant grants, unavailable billing without Stripe configuration, and session revocation. The browser dashboard loaded the expected organization, two users, Pro entitlement, and zero connected integrations. `quota-smoke` verifies Free and Pro exhaustion returns HTTP 429, account-specific usage meters, and a separate member's remaining quota; it removes its tagged usage rows in a finally block. `model-smoke` verifies a real SSE response, exact requested output, positive usage, and completion without an error event.

The current API container uses a provider-only override at `/private/tmp/coop-dogfood-provider-only.compose.json` and a mode-600 environment file. Only model-provider keys were selected from the existing authorized service configuration. Database, authentication, billing, and collaboration credentials were excluded. Neither temporary file belongs in the repository. Recreating the base compose environment alone omits these provider credentials; include the protected override when restarting the model-enabled API. Never print its environment file.

Successful billing checkout, real code retrieval, and connected integrations have not been certified by this environment. Complete those checks with test-service credentials and disposable external fixtures. Keep credentials out of this committed compose file. Do not point these fault or seed tools at production.

Continuation evidence is in [the run directory](runs/2026-10-03-continuation/). Earlier selection latency and incorrect proposals are retained as historical failures. Later live local-file checks verified Apply, Save, Undo, Stop followed by a narrow rename, and preservation of rejected/applied decisions after window reload. These observations cover those exact fixtures and candidates; they do not certify the entire release matrix.
