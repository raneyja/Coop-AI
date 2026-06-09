# Job Queue & Batch Processing

CoopAI runs expensive operations (knowledge gap scans, dependency graph builds, repository indexing) through an async job queue on the webhook backend.

## Runtime

Jobs run inside the same process as the webhook server:

```sh
npm run build:backend
npm run start:webhooks
```

The extension submits jobs via HTTP and receives progress through VS Code `postMessage` events.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/jobs` | Create a job |
| GET | `/api/jobs/:id` | Status, progress, ETA |
| GET | `/api/jobs/:id/result` | Completed result payload |
| GET | `/api/jobs/:id/stream` | SSE progress stream |
| DELETE | `/api/jobs/:id` | Cancel queued job |
| GET | `/api/jobs/stats` | Queue health dashboard |

### Create job

```json
POST /api/jobs
{
  "type": "scan_knowledge_gaps",
  "priority": "normal",
  "userId": "user-123",
  "params": { "repoId": "github:acme/app", "file": "src/index.ts" }
}
```

Response `202`:

```json
{
  "jobId": "uuid",
  "status": "queued",
  "estimatedWaitTimeMs": 180000,
  "estimatedWaitTime": "3 minutes"
}
```

## Configuration

Environment variables (see `src/config/jobQueueConfig.ts`):

| Variable | Default | Description |
|----------|---------|-------------|
| `JOBS_BACKEND` | `memory` | `memory`, `postgres`, or `redis` (redis falls back to memory) |
| `JOBS_WORKER_CONCURRENCY` | `2` | Concurrent workers |
| `JOBS_MAX_DURATION_MS` | `300000` | Per-job timeout |
| `JOBS_RESULT_RETENTION_DAYS` | `7` | On-demand result TTL |
| `JOBS_SCHEDULED_RETENTION_DAYS` | `30` | Scheduled job result TTL |
| `DATABASE_URL` | — | PostgreSQL when `JOBS_BACKEND=postgres` |
| `COOP_JOBS_API_TOKEN` | — | Bearer token for `/api/jobs` routes |

VS Code setting:

- `coopAI.jobsBaseUrl` (default `http://localhost:8787`)

## PostgreSQL

Apply the schema:

```sh
psql "$DATABASE_URL" -f migrations/001_jobs.sql
```

Set:

```sh
JOBS_BACKEND=postgres
DATABASE_URL=postgres://...
```

## Scheduled jobs

Cron schedules (via `node-cron`):

- Nightly repository index: `0 2 * * *`
- Weekly knowledge gap scan: `0 3 * * 0`

Scheduled jobs use `priority: low` and longer result retention.

## Rate limits

Per-user limits (see `src/jobs/rateLimit.ts`):

| Job type | Per hour | Per day |
|----------|----------|---------|
| Knowledge gaps | 1 | 5 |
| Dependency graph | 3 | 10 |

HTTP `429` includes `retryAfterMs`.

### Knowledge gap scan reuse

Repeat **Knowledge Gaps** clicks for the same repo + file within **2 hours** reuse the last completed
`scan_knowledge_gaps` result instead of enqueueing a new job. The API response includes `"cached": true`
and does **not** count against the hourly/daily limits.

## Architecture

```
Webview (JobProgress) ←postMessage→ Extension (JobApiClient) → Webhook Server (JobQueue + WorkerPool) → GraphCache
```

Hot results (&lt;1 hour) stay in memory; warm results persist in PostgreSQL when configured.

## Redis / Bull (future)

`JOBS_BACKEND=redis` logs a warning and uses the in-memory queue until a BullMQ adapter is added.
