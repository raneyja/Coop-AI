import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Pool, type Client } from "pg";
import databasePoolOptions from "../server/databasePoolOptions.cjs";
import type { ServerConfig } from "../server/serverConfig";

export const WORKER_PRESENCE_TTL_MS = 15_000;
const REFRESH_MS = 5_000;
const SHA = /^[0-9a-f]{64}$/;
const FLEET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
type WorkerState = { acceptingWork: boolean; capacity: number; activeJobs: number };

/** Hash the actual launched artifact; never accept an environment's self-claimed build id. */
export function workerArtifactSha256(filename: string): string {
  try {
    const stat = statSync(filename);
    if (!stat.isFile() || stat.size < 1 || stat.size > 128 * 1024 * 1024) throw new Error();
    return createHash("sha256").update(readFileSync(filename)).digest("hex");
  } catch { throw new Error("Worker artifact identity is unavailable"); }
}

/** Owned by the dedicated worker process, including idle time and shutdown. */
export class WorkerPresence {
  private readonly instanceId = randomUUID();
  private readonly pool: Pool;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<boolean>;
  private closed = false;
  private closing?: Promise<boolean>;
  private lastRenewed = -Infinity;

  public constructor(private readonly options: {
    databaseUrl: string; fleetId: string; bundleSha256: string; state: () => WorkerState;
  }) {
    if (!FLEET.test(options.fleetId) || !SHA.test(options.bundleSha256)) throw new Error("Invalid worker presence identity");
    this.pool = new Pool({ ...databasePoolOptions(options.databaseUrl), max: 1,
      connectionTimeoutMillis: 500, statement_timeout: 750, lock_timeout: 500,
      query_timeout: 1_000, idleTimeoutMillis: 1_000, application_name: "coop-worker-presence" });
    this.pool.on("error", () => { this.lastRenewed = -Infinity; });
  }

  public get fresh(): boolean { return !this.closed && performance.now() - this.lastRenewed < WORKER_PRESENCE_TTL_MS; }

  public async start(): Promise<void> {
    if (this.closed || this.timer) throw new Error("Worker presence lifecycle already started or closed");
    if (!await this.refresh()) { await this.stop(); throw new Error("Worker presence could not be registered"); }
    this.timer = setInterval(() => { void this.refresh(); }, REFRESH_MS);
  }

  /** One bounded write at a time; failure never grants extra freshness. */
  public async refresh(): Promise<boolean> {
    if (this.closed) return false;
    if (this.pending) return this.pending;
    const write = async (): Promise<boolean> => {
      try {
        const state = this.options.state();
        if (typeof state.acceptingWork !== "boolean" || !Number.isInteger(state.capacity) || state.capacity < 1 || !Number.isInteger(state.activeJobs)
          || state.activeJobs < 0 || state.activeJobs > state.capacity) throw new Error();
        await this.pool.query(`WITH tick AS (SELECT clock_timestamp() AS t)
          INSERT INTO worker_presence(instance_id,fleet_id,bundle_sha256,accepting_work,capacity,active_jobs,observed_at,lease_expires_at)
          SELECT $1,$2,$3,$4,$5,$6,t,t+INTERVAL '15 seconds' FROM tick
          ON CONFLICT(instance_id) DO UPDATE SET accepting_work=EXCLUDED.accepting_work,
            capacity=EXCLUDED.capacity,active_jobs=EXCLUDED.active_jobs,
            observed_at=EXCLUDED.observed_at,lease_expires_at=EXCLUDED.lease_expires_at`,
          [this.instanceId,this.options.fleetId,this.options.bundleSha256,state.acceptingWork,state.capacity,state.activeJobs]);
        this.lastRenewed = performance.now();
        // Bounded metadata retention; no current lease or other fleet is removed.
        await this.pool.query(`DELETE FROM worker_presence WHERE instance_id IN (
          SELECT instance_id FROM worker_presence WHERE fleet_id=$1
            AND lease_expires_at<clock_timestamp()-INTERVAL '1 day' LIMIT 100)`, [this.options.fleetId]);
        return true;
      } catch { this.lastRenewed = -Infinity; return false; }
    };
    this.pending = write();
    try { return await this.pending; } finally { this.pending = undefined; }
  }

  public async stop(): Promise<boolean> {
    if (this.closing) return this.closing;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.closing = (async () => {
      await this.pending;
      let removed = false;
      try {
        await this.pool.query("DELETE FROM worker_presence WHERE instance_id=$1 AND fleet_id=$2 AND bundle_sha256=$3",
          [this.instanceId,this.options.fleetId,this.options.bundleSha256]);
        removed = true;
      } catch { /* Its existing bounded database-clock lease will expire. */ }
      await this.pool.end();
      return removed;
    })();
    return this.closing;
  }
}

/** Read through the existing operator diagnostic client; never the job pool. */
export async function workerFleetReadiness(client: Pick<Client, "query">, config: ServerConfig): Promise<{
  status: "ok" | "failed" | "unverified"; reason?: string;
  counts?: { fresh: number; incompatible: number; invalid: number; minimum: number };
}> {
  const { workerFleetId, expectedWorkerBundleSha256, minimumReadyWorkers } = config;
  if (!workerFleetId || !FLEET.test(workerFleetId) || !expectedWorkerBundleSha256 || !SHA.test(expectedWorkerBundleSha256)
    || typeof minimumReadyWorkers !== "number" || !Number.isSafeInteger(minimumReadyWorkers) || minimumReadyWorkers < 1) {
    return { status: "unverified", reason: "worker_fleet_expectations_unconfigured" };
  }
  // API-local workers do not report a dedicated worker artifact; their Boolean
  // accepting signal cannot establish this split-process fleet contract.
  if (config.jobsWorkersEnabled) return { status: "unverified", reason: "local_worker_artifact_not_registered" };
  const result = await client.query<{ fresh: number; incompatible: number; invalid: number }>(`SELECT
    COUNT(*) FILTER (WHERE accepting_work AND observed_at<=clock_timestamp() AND lease_expires_at>clock_timestamp()
      AND bundle_sha256=$2 AND lease_expires_at<=observed_at+INTERVAL '15 seconds')::int AS fresh,
    COUNT(*) FILTER (WHERE accepting_work AND observed_at<=clock_timestamp() AND lease_expires_at>clock_timestamp()
      AND bundle_sha256<>$2)::int AS incompatible,
    COUNT(*) FILTER (WHERE observed_at>clock_timestamp() OR lease_expires_at>observed_at+INTERVAL '15 seconds')::int AS invalid
    FROM worker_presence WHERE fleet_id=$1`, [workerFleetId,expectedWorkerBundleSha256]);
  const row = result.rows[0];
  const counts = { fresh: row.fresh, incompatible: row.incompatible, invalid: row.invalid, minimum: minimumReadyWorkers };
  if (counts.invalid > 0) return { status: "failed", reason: "worker_presence_clock_or_lease_invalid", counts };
  if (counts.incompatible > 0) return { status: "failed", reason: "unexpected_worker_artifact", counts };
  if (counts.fresh < counts.minimum) return { status: "failed", reason: "worker_fleet_below_required_presence", counts };
  return { status: "ok", counts };
}
