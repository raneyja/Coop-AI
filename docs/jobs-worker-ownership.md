# Worker ownership and recovery proposal

This change is an isolated EH08 proposal, not an enterprise release qualification.
Index recovery, replica scaling, and automated reconciliation remain disabled
until the complete effect contracts and fault gates below are independently qualified.

## Durable attempt owner

Migration `034_job_attempt_leases.sql` adds owner, attempt, database-time expiry,
available-at, and effect-quarantine fields. Old SQL is immutable. Stop all old
workers and any embedded API workers before applying it; mixed-version queue
writers can bypass the new contracts. Legacy running rows fail honestly rather
than replaying unknown effects. Legacy running index-effect rows are quarantined.

Postgres claims use a transaction, shared advisory admission lock, a fresh
statement snapshot, and `FOR UPDATE SKIP LOCKED`. A claimed attempt receives a
new UUID. Progress, renewals, retry and terminal writes compare that owner and
attempt against a live lease using database time. Status and result persistence
commit in one SQL statement. Rejected stale completions emit no completion event.

Read-only work can be reclaimed only after lease expiry; restart does not steal
a renewing peer. Retry backoff is stored in `available_at`, with three retries
by default. Crash recovery consumes the same retry budget. There is no delayed
in-memory retry callback that can revive cancelled work.

## Effect admission and conservative recovery

`INDEX_REPOSITORY`, `BUILD_DEPENDENCY_GRAPH`, and `BUILD_STRUCTURE_MANIFEST`
mutate shared state. Only one such job is admitted globally at a time across
Postgres workers. A failed, cancelled, partial or expired effect attempt is
quarantined; no replacement effect claim or index purge is admitted until
operator reconciliation. Read-only jobs still run. Automatic retries are not
permitted after an effect executor starts. A claim stopped before its first
execution progress update may be released without consuming a retry.

The default worker concurrency is one. Increasing it does not enable safe
multi-worker index recovery. Quarantine is a durable operational boundary,
not a note in this document: claims and purge check it under the same database
admission lock, and the queue cannot delete quarantined rows.

The shared effect helper locks the actual running job row in the write
transaction and verifies owner, attempt, expiry, immutable parameters, job type,
and user identity. Actual status, symbol replacement, embeddings, dependency
replacement, manifest upsert/prune, and inventory writers use that helper.
Cancellation/reclaim wait while an already admitted DB transaction commits;
later stale writes are refused. These checks do not make unrelated writers safe.

Transient clones use job and attempt identity, remain private, and are deleted
in the existing `finally` owner. SCIP receives cancellation. Zoekt builds in a
hidden attempt directory, verifies every shard's tenant prefix, and publishes
only while the durable attempt is owned. Successful and pre-publication optional
indexer failures remove staging. Publication-admission, rename and ambiguous
commit failures propagate to the actual index caller and worker as fatal errors;
remaining attempt artifacts are retained for reconciliation and the job is
failed/quarantined, never downgraded to optional Zoekt unavailability.
Multiple shard renames are not atomic across a process kill. Such failures must
remain quarantined; no atomic-generation or retry-idempotency pass is claimed.

Index purge uses one DB transaction for stored index rows and the same admission
exclusion. Its cache eviction does not enqueue a second DB deletion. Filesystem
unlink cannot be rolled back if the DB commit fails, so reconciliation remains
required. Org-wide shard purge and the org-disable metadata transaction have
not yet been brought under the complete admission contract.

## Shutdown

Stop halts claims and cron scheduling, then aborts active executors. The worker
keeps the execution slot and heartbeat until the actual executor settles. A
timeout does not release an executor still writing effects. The stop bound is
10 seconds by default; if it expires the standalone process exits with failure
before a replacement is allowed. Clean shutdown closes HTTP connections,
queue pool and shared pool. Repeated shutdown signals share one shutdown path.
Worker health becomes unavailable when its pool stops accepting work. In-flight
renewal callbacks are bound to their live execution. Once executor/final progress
settle, the terminal CAS owns the outcome and late renewal responses cannot
stop a healthy pool; active ownership loss still aborts work and stops claims.

Configuration is optional; defaults are shown:

- `JOBS_WORKER_CONCURRENCY=1`
- `JOBS_LEASE_DURATION_MS=30000`
- `JOBS_HEARTBEAT_INTERVAL_MS=10000`
- `JOBS_SHUTDOWN_TIMEOUT_MS=10000`
- `JOBS_MAX_DURATION_MS=300000`

The heartbeat must be positive and less than half the lease. Values must be
finite. The standalone process must be physically terminated after a failed
drain before attempting index recovery.

## Operator reconciliation

Do not clear quarantine because a heartbeat stopped. Establish termination of
every old executor and its subprocesses, including embedded API workers. Keep
effect workers stopped while inspecting partial index/status/cache/shard state.
Restore a coherent generation or purge and rebuild it; reconcile org status and
completion consumers. Only then, under the admission lock and a transaction,
may an authorized operator clear the specific quarantine and enqueue a new
attempt. Preserve the old failed/cancelled attempt and its identity for audit.
This proposal does not provide a trusted automated reconciliation command, so
recovery is not release-ready. Do not treat direct SQL changes in fault fixtures
as an operational recovery implementation.

## Gates still open

`JOBS-LEASE` and `JOBS-RECLAIM` have scoped automated evidence for the durable
queue contract. The complete six-gate package still requires independent review.
`JOBS-FENCING`, `JOBS-CRASH`, `JOBS-SHUTDOWN`, and `JOBS-IDEMPOTENCY` are not
enterprise passes from these tests alone.

Remaining engineering owners:

- `PersistingGraphCache`: buffered publication must retain job identity and
  conditionally commit; `setGraph`, `setDependencies`, initial upsert and a
  previously in-flight `flush` cannot write an older snapshot over a successor.
- Org disable/delete: status, grants, repo purge and org-wide shard purge need
  one reviewed admission/reconciliation boundary before metadata is changed.
- Zoekt: readers must observe a coherent generation across multi-shard swap,
  crash and removal of obsolete shards, with durable reconciliation.
- Completion consumers: decide whether durable outbox/replay is required;
  in-memory EventEmitter delivery is not crash-durable.
- Scheduler/enqueue: replica cron ownership and concurrent active-index enqueue
  deduplication require qualification before worker replica scaling.
- Real indexer faults: exercise actual clone/SCIP/Zoekt/embedding and cache
  publication end-to-end, including crash between each effect and completion.

The isolated test command is `npm run test:jobs-leases` with
`EH08_TEST_DATABASE_URL` pointing to the specifically guarded disposable
database `127.0.0.1:56548/eh08_disposable` as user `eh08`. The EH10 canonical
no-connect admission helper is an explicit integration dependency, generalized
with a hardcoded EH08 fixture; it rejects all query/fragment overrides before
any Pool/backend is constructed. `node --test scripts/job-leases-target.test.mjs`
checks the actual destructive suite cannot construct a client on rejected input.
The integration command applies the actual schema, runs
constructed queues/workers and actual index stores, pauses/resumes and kills
only fixture children, and uses temporary shard paths. It does not access
production repositories, accounts, quotas, or providers.
