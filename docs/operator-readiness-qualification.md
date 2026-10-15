# Operator dependency diagnostics and qualification

This proposal adds `GET /v1/operator/readiness`. It uses the existing bearer operator session and role rules: any enabled, nonexpired operator, including viewer, may read diagnostics. Customer sessions, org API keys and legacy API tokens do not authorize it. The exact GET is dispatched from headers before generic request-body collection. Missing bearer, invalid role and expired sessions cannot wait for an unfinished body. Declared positive Content-Length or Transfer-Encoding is forbidden: auth denial remains401; an authorized actor receives400, or413 when declared length exceeds the existing5MiB cap. These responses close the connection. Input may be discarded while bounded authentication runs, never collected, and exceeding the existing byte limit aborts the request. A zero-length GET remains supported. Other methods/routes retain their original parser, auth and body limit.

It runs before customer authentication so a blocked customer pool does not become its authorization queue.

`GET /health` remains the existing compatible liveness endpoint. Keep Railway and Docker restart probes on `/health`. **Do not configure restart or traffic admission against the new endpoint:** its required worker/cache/index contracts are incomplete and it intentionally returns 503. No replacement probe, deploy configuration, new secret, migration, CI job or operator UI was added.

## What the response means

Authorized requests return `ready:false`, `scope:api_dependency_diagnostics` and checks. A healthy measured database/schema/configuration does not make the product enterprise ready.

- `database:ok` means a dedicated connection to the configured API target succeeded. It does not certify the existing application pool, write transactions or customer traffic.
- `schema:ok` means the deployed `migrations/` files exactly match nonnull SHA-256 ledger rows, the specified core columns are visible, and actual reads of the required objects succeed. It does not certify every schema constraint, write privilege, index content, migration rollout or features added by other proposals. Expand the explicit object contracts when integrating new supported paths. Unknown legacy checksums fail; use the EH10 reviewed adoption process, never inferred backfills.
- `configuration:ok` means enforced API auth, a configured credential key, the actual Postgres queue backend and matching API/queue configuration, and a supported actual cache type. It does not prove key escrow/decryption compatibility, Google/SSO/integration/vendor availability or an external provider call.
- `graphStorage` remains unverified. The Postgres cache buffers publication without a complete attempt/generation freshness contract; the supported memory cache cannot prove durable cross-process state. Redis/hybrid selections fall back to memory in current source and fail configuration admission.
- With colocated workers enabled, `workers:ok` means only the current EH08 `acceptingWork` signal is true. A stopped worker fails. A separate worker fleet remains unverified because there is no trusted fleet identity/freshness contract. Queue quietness, last completion and an HTTP200 worker process do not prove freshness.
- `indexStorage` remains unverified until storage ownership, a coherent served generation and reader/cache synchronization have a complete measurable contract. No root HTTP page or paid search/model request substitutes for this evidence.

Missing/invalid/disabled/expired operator sessions return 401 without diagnostics. A missing DB, bounded connection/query failure, shutdown, or saturated diagnostic admission returns a sanitized 503 without database errors, secrets, config values, source bodies or credentials. Responses are `Cache-Control:no-store`; the API supplies its existing `x-request-id` header. No provider probe, alert or external message is sent.

At most two diagnostic clients exist per server instance; excess requests fail promptly. They never enter the application's pool queue. Connections have 500ms admission, queries 1000ms statement and 500ms lock limits, and an overall 1500ms socket deadline. Request disconnect stops subsequent diagnostic SQL. Admission remains occupied until the current readonly SQL settles under its existing lock/statement/deadline bounds; merely destroying the transport would leave a server lock waiter while a successor starts. Every completed path destroys its owned socket and ends its client; the diagnostic owner’s close cancels outstanding sockets. The API’s terminal close event marks this owner closed; an already active request is always bounded by its deadline. These are local bounds, not fleet-wide rate limits or latency guarantees under event-loop suspension. Repeat qualification on the assembled deployment and account for every API replica.

## Repeatable disposable qualification

**Terminal — a new isolated proposal checkout.** The test suite only admits the explicit loopback port 56339 `eh11_disposable` database/user `eh11`; target and effective PG parsing are checked with the reviewed EH10 helper plus EH08 fixture-identity addendum before its first Pool. Do not reuse a live database, existing service or volume. Coordinate this fixed port with the owner. The proposal report records the owned tmpfs fixture identity and cleanup owner.

1. Integrate the pinned EH10 verified TLS helper/declaration/DB caller and the pinned EH08v2 queue/worker proposal. Include its separately reviewed disposable-target addendum. Preserve all historical SQL; apply current migrations with the EH10 runner to a clean, explicitly admitted fixture. The author fixture contains immutable 001–032 plus additive 034. It has no inferred ledger backfill.
2. Build the actual API artifact and the focused test. The test starts its own bounded local API child with explicit fixture configuration; the separate main artifact preserves `require.main` identity. A combined test bundle of the API main would start default configuration accidentally and is not valid qualification.

```sh
npm run lint
npm run build:backend
node_modules/.bin/esbuild src/server/operators/readiness.integration.test.ts --bundle --platform=node --format=cjs --external:pg --external:web-tree-sitter --external:tree-sitter-wasms --external:@sentry/node --outfile=dist/tests/readiness.integration.test.cjs
node --test dist/tests/readiness.integration.test.cjs
npm run test:operator
```

3. Pass requires all recorded controls without skips, including actual API unfinished-length/chunked/oversized GET negatives, missing/invalid/expired actors, zero-length/query counterpart, preserved CORS/request ID, exact-path routing and disconnect admission retention: actual operator boundaries and positive measured SQL access; missing/mismatched/legacy ledger and real-column drift; absent/mutated deployed artifacts; actual config/backend mismatches; local worker admission changes; blocked auth and table locks; concurrent capacity; connecting-but-stalled PostgreSQL and a completed real PG query whose response is withheld beyond the overall socket deadline; owned client cancellation/cleanup; and public liveness during DB failure. Required unverified dependencies must remain `ready:false`/503. This suite alters only the admitted fixture schema and restores temporary changes, then closes its child HTTP processes, workers and clients. It does not silently create or drop production state.
4. A live operator may request the endpoint through the API using the existing operator-session mechanism. Inspect status/body and request ID in a trusted HTTP client; never paste bearer tokens into committed commands/evidence. The current Ops client treats 503 as an error and no new readiness panel is supplied. Existing health clients keep their existing response contract.

## Remaining enterprise qualification

OPS-READINESS is open until the assembled candidate has trusted fleet freshness and cache/index/storage generation contracts, required new schema object checks, effective deployed configuration/key identity, role/TLS/proxy boundaries and measured positive/negative dependency admission. The private controls establish the diagnostic implementation only.

OPS-TRACE retains the existing request ID and separate prior timing evidence; this proposal adds no universal trace/latency claim. Alerts, real delivery, integrated load/soak, real provider capacity/cost and extension useful-answer clocks remain separate gates. Do not send external alerts as part of these checks.

The existing Oracle minimum backup example is a weekly database dump, not a tested recovery contract. A restore qualification must identify the clean target, artifact checksum and creation clock, migrations and app build, encryption-key escrow/rotation compatibility, related storage/index generation and expiry behavior; prove restored application reads and measured restore duration/data age. The EH08 buffered cache/coherent shard generation and physical worker reconciliation gaps must be resolved for a complete index recovery claim. No backup/restore, production RPO/SLA, load, soak, deployment or live vendor qualification is claimed here.
