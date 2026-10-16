# Migration ownership, integrity and verified TLS

The migration runner owns one transaction per SQL file and its ledger insert.
`npm run migrate`, `scripts/migrate.sh` and Railway's pre-deploy command use the
same runner. Set `DATABASE_URL` explicitly in the terminal or deployment service;
there is no default database target. Keep host, database and credentials in the
URL authority/path; migration query parameters may not override target/session.
Never run qualification faults against a customer, dogfood or production database.

## SQL admission and recovery

Historical SQL files remain byte-for-byte unchanged. The runner lexes statement
boundaries, retaining quoted strings, quoted identifiers, comments and dollar
bodies. It removes only one exact outer `BEGIN; ... COMMIT;` pair in memory.
All other top-level transaction commands and session settings fail before the
first database connection. Malformed quoted input and invalid UTF-8 fail too.
Nontransactional or external operations (including concurrent indexes, VACUUM,
CALL and COPY) are unsupported: create and qualify an explicit resumable protocol
before adding such a migration. Admission is not a sandbox for untrusted SQL;
review every migration, including functions, extensions and external side effects.

A database-scoped session advisory lock serializes updated runners. SQL and its
SHA-256 ledger row commit together. A database error or terminated session rolls
back that file; earlier completed files remain applied. Retry the same release
runner to continue. If the client loses the COMMIT response, a retry consults the
ledger to distinguish a committed file from one that must be retried. Do not
represent application rollback as schema recovery. Do not run the old unlocked
runner concurrently with the new runner; drain older deploy migrations first.

## Historical ledger compatibility

The additive nullable `schema_migrations.checksum` column preserves existing
filenames and application timestamps. NULL means historical content is unknown;
newly applied files record the hash of the bytes actually admitted for execution.
A repeat run compares known hashes and fails if an applied file changes or is
missing. Never populate a historical NULL from today's checkout and call that
proof of historical application. Missing known probe objects fail without
silently deleting a ledger record. These probes do not prove every historical
migration or all effects of a probed migration.

An existing schema without a ledger fails closed instead of assuming Docker init
ran every file. Adoption requires an explicit reviewed reconciliation against the
original deployment artifacts, database schema and data changes. Preserve a
backup and the evidence identifying which migrations ran; only record proven
legacy filenames with NULL checksums. If provenance is missing, keep that state
unqualified and design a reviewed forward repair. Do not delete customer rows,
replay non-idempotent historical SQL blindly or use a table's existence as proof
of the full migration. The historical chat-feed repair script now also stops on
these mismatches; it no longer creates false evidence automatically.

The frozen 0.1.13 SQL hash manifest and old-runner test fixture verify an actual
prior-release upgrade without duplicating historical SQL. This proves ledger
compatibility for that release fixture; staging/production state and deployed
old/new application compatibility still require pinned qualification.

## One database TLS policy

`src/server/databasePoolOptions.cjs` is shared by the server pool, jobs pool,
migration runner and maintenance/test pool constructors. `DATABASE_SSL=true`,
URL `sslmode=require|verify-ca|verify-full|prefer`, or URL TLS configuration uses
CA verification and verifies the actual parsed target's identity. These modes
are deliberately normalized to full verification; no opportunistic plaintext
fallback is supported. `sslrootcert` loads the intended CA file; client cert/key
parameters remain supported. Supply the real database CA from the service
operator as a mounted file if its certificate is not trusted by the system.

The helper removes TLS URL parameters before constructing pg pools so pg cannot
replace the enforced TLS object. An explicit identity checker handles IP targets,
where pg omits SNI. `no-verify` and `uselibpqcompat=true` fail closed. Conflicting
`DATABASE_SSL=true` and URL/PG SSL disable settings fail. Plaintext local use stays
supported when TLS is not selected. A private self-signed test CA is never a
production trust anchor. Verify Railway's actual host/CA before deployment rather
than weakening certificate checks when a connection fails.

## Qualification

Run `node --test scripts/run-migrations.test.mjs` for lexical admission and effective
pg options. Database integration tests require `EH10_TEST_DATABASE_URL` pointing
at a dedicated disposable PostgreSQL/pgvector server, currently guarded to
localhost port 56547, user `eh10` and database `eh10_disposable`. The pure
shared guard validates the effective pg target before any client/pool; all base
URL query parameters, fragments and non-PostgreSQL protocols are rejected. They never silently skip a
missing required database. The coordinator must provision the corresponding
isolated CI service or deliberately update and review that guard for CI.

Run `node --test scripts/run-migrations.integration.test.mjs` for fresh install,
actual prior upgrade, repeat/checksum changes, actual migration 032 ledger faults,
concurrent processes and killed-session recovery. TLS tests additionally require
`EH10_TEST_CA_FILE`, `EH10_TEST_WRONG_CERT_FILE` and `EH10_TEST_KEY_FILE` pointing to
short-lived dedicated fixture certificates; run `npx --no-install tsx --test
scripts/database-tls.integration.test.ts`. The test certificates and keys stay
outside committed source. Root lint plus backend/worker/backend-admin-CLI builds verify the
complete shared-policy call sites; `build:admin` builds the backend admin CLI,
not the Next.js admin portal. These isolated checks are automated evidence,
not a live deployment or a full enterprise release qualification.
