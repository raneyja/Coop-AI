import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Socket } from "node:net";
import { resolve } from "node:path";
import type { ServerResponse } from "node:http";
import { Client } from "pg";
import type { GraphCache } from "../../cache/graphCache";
import { PersistingGraphCache } from "../../cache/graphCachePostgres";
import type { CacheConfig } from "../../config/webhookConfig";
import type { JobRuntime } from "../../jobs/jobRuntime";
import { workerFleetReadiness } from "../../jobs/workerPresence";
import { extractBearerToken } from "../authMiddleware";
import { writeJson } from "../adminApiShared";
import databasePoolOptions from "../databasePoolOptions.cjs";
import type { ServerConfig } from "../serverConfig";
import { OperatorStore } from "./operatorStore";
import { requireOperator, resolveOperatorContext } from "./operatorAuthMiddleware";

const MAX_CONCURRENT_PROBES = 2;
const DEADLINE_MS = 1_500;
// API runtime contracts. The ledger alone does not prove these objects still exist.
const REQUIRED_COLUMNS: Record<string, string[]> = {
  organizations: ["id", "plan", "operator_status"],
  api_keys: ["org_id", "key_hash"],
  users: ["id", "org_id", "deactivated_at"],
  org_memberships: ["org_id", "user_id", "role"],
  user_sessions: ["token_hash", "expires_at"],
  org_credentials: ["org_id", "encrypted_token"],
  org_repos: ["org_id", "repo_id", "embedding_status"],
  org_sso_config: ["org_id", "enabled"],
  auth_identities: ["user_id", "provider", "provider_subject"],
  auth_tokens: ["user_id", "token_hash"],
  chat_threads: ["org_id", "user_id"],
  chat_messages: ["thread_id", "content"],
  operators: ["id", "role", "disabled_at"],
  operator_sessions: ["operator_id", "token_hash", "expires_at"],
  jobs: ["id", "status", "owner_id", "attempt_id", "lease_expires_at", "effect_quarantined"],
  worker_presence: ["instance_id", "fleet_id", "bundle_sha256", "accepting_work", "capacity", "active_jobs", "observed_at", "lease_expires_at"],
  job_results: ["job_id", "expires_at"],
  graph_snapshots: ["org_id", "repo_id", "payload", "generation", "revision", "origin"],
  graph_publication_heads: ["org_id", "repo_id", "requested_generation", "published_generation", "revision", "tombstone", "origin", "published_job_id"],
  repo_manifests: ["org_id", "repo_id"],
  repo_symbol_index: ["org_id", "repo_id"],
  repo_embeddings: ["org_id", "repo_id"],
  repo_dependency_edges: ["org_id", "repo_id"],
  usage_events: ["org_id", "created_at"],
  stripe_webhook_events: ["event_id", "status"],
  support_reports: ["id", "org_id"]
};

type Check = { status: "ok" | "failed" | "unverified"; reason?: string };
type Dependencies = {
  databaseUrl?: string;
  serverConfig: ServerConfig;
  cacheConfig: CacheConfig;
  cache: GraphCache;
  jobs: JobRuntime;
  migrationsDirectory?: string;
};

/** Diagnostic admission is independent of the customer pool, queue and providers. */
export class OperatorReadiness {
  private active = 0;
  private closed = false;
  private readonly sockets = new Set<Socket>();
  private readonly migrations: Map<string, string> | undefined;

  public constructor(private readonly dependencies: Dependencies) {
    try {
      const directory = dependencies.migrationsDirectory ?? resolve(process.cwd(), "migrations");
      const files = readdirSync(directory).filter(name => /\.sql$/i.test(name)).sort();
      if (!files.length || files.length > 256 || files.some(name => !/^\d{3}_[A-Za-z0-9_]+\.sql$/.test(name))) throw new Error();
      this.migrations = new Map(files.map(name => {
        const bytes = readFileSync(resolve(directory, name));
        if (bytes.length > 512 * 1024) throw new Error();
        return [name, createHash("sha256").update(bytes).digest("hex")];
      }));
    } catch { this.migrations = undefined; }
  }

  public close(): void {
    this.closed = true;
    for (const socket of this.sockets) socket.destroy();
  }

  public async handle(headers: Record<string, string | undefined>, response: ServerResponse, unexpectedBody?: { oversized: boolean }, signal?: AbortSignal): Promise<void> {
    if (response.destroyed || signal?.aborted) return;
    response.setHeader("cache-control", "no-store");
    if (!extractBearerToken(headers)) { requireOperator(undefined, response); return; }
    if (this.closed || this.active >= MAX_CONCURRENT_PROBES || !this.dependencies.databaseUrl) {
      writeJson(response, 503, { error: "readiness_unavailable" }); return;
    }
    this.active += 1;
    let socket: Socket | undefined;
    let client: Client | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    // Retain admission until the current bounded SQL settles. Closing only the
    // transport can leave a PG lock waiter alive while a successor is admitted.
    const cancel = () => { cancelled = true; };
    response.once("close", cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      client = new Client({
        ...databasePoolOptions(this.dependencies.databaseUrl),
        application_name: "coop-readiness",
        connectionTimeoutMillis: 500,
        statement_timeout: 1_000,
        lock_timeout: 500,
        stream: () => {
          socket = new Socket();
          this.sockets.add(socket);
          socket.once("close", () => this.sockets.delete(socket!));
          return socket;
        }
      });
      client.on("error", () => undefined); // Never emit raw DSN/database errors into logs or responses.
      timer = setTimeout(() => socket?.destroy(), DEADLINE_MS);
      await client.connect();
      if (cancelled) return;
      await client.query("BEGIN READ ONLY");
      if (cancelled) return;
      const operator = await resolveOperatorContext(headers, new OperatorStore(client));
      if (cancelled) return;
      if (!requireOperator(operator, response)) return;
      if (unexpectedBody) {
        writeJson(response, unexpectedBody.oversized ? 413 : 400, { error: "readiness_body_not_allowed" });
        return;
      }
      const schema = await this.schemaCheck(client, () => cancelled);
      if (cancelled) return;
      const { cacheConfig, cache, serverConfig, jobs } = this.dependencies;
      const configOk = serverConfig.requireApiAuth && Boolean(serverConfig.credentialsEncryptionKey)
        && jobs.config.backend === "postgres" && jobs.queue.getBackend().name === "postgres"
        && sameDatabase(this.dependencies.databaseUrl, jobs.config.databaseUrl)
        && ["postgres", "memory"].includes(cacheConfig.backend)
        && (cacheConfig.backend !== "postgres" || (cache instanceof PersistingGraphCache
          && sameDatabase(this.dependencies.databaseUrl, cacheConfig.connectionString)
          && cache.usesDatabase(this.dependencies.databaseUrl)));
      const graphStorage = cacheConfig.backend === "postgres" && cache instanceof PersistingGraphCache
        ? !configOk || schema.status !== "ok"
          ? { status: "unverified" as const, reason: "graph_configuration_or_schema_unverified" }
          : await cache.getStorageReadiness(client)
        : { status: "unverified" as const, reason: "memory_cache_persistence_and_freshness_unverified" };
      if (cancelled) return;
      const workers = !configOk || schema.status !== "ok"
        ? { status: "unverified" as const, reason: "worker_configuration_or_schema_unverified" }
        : await workerFleetReadiness(client, serverConfig);
      if (cancelled) return;
      const checks: Record<string, Check> = {
        database: { status: "ok" },
        schema,
        configuration: { status: configOk ? "ok" : "failed", ...(configOk ? {} : { reason: "runtime_configuration_incomplete" }) },
        graphStorage,
        workers,
        indexStorage: { status: "unverified", reason: "shared_storage_and_served_generation_contract_missing" }
      };
      await client.query("ROLLBACK");
      // Required index coherence remains unprovable: never substitute transport/queue quietness.
      writeJson(response, 503, { ready: false, scope: "api_dependency_diagnostics", checks });
    } catch {
      if (!cancelled && !response.destroyed && !response.headersSent) writeJson(response, 503, { error: "readiness_unavailable" });
    } finally {
      response.off("close", cancel);
      signal?.removeEventListener("abort", cancel);
      if (timer) clearTimeout(timer);
      // Owned socket termination cancels connecting, blocked and in-flight queries; no pool queue accumulates.
      socket?.destroy();
      await client?.end().catch(() => undefined);
      this.active -= 1;
    }
  }

  private async schemaCheck(client: Client, cancelled: () => boolean): Promise<Check> {
    if (!this.migrations) return { status: "failed", reason: "migration_artifact_unavailable" };
    const ledger = await client.query("SELECT filename, checksum FROM public.schema_migrations");
    if (ledger.rows.length !== this.migrations.size || ledger.rows.some(row => this.migrations?.get(String(row.filename)) !== row.checksum)) {
      return { status: "failed", reason: "migration_identity_mismatch" };
    }
    if (cancelled()) throw new Error("Readiness request cancelled");
    const columns = await client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])", [Object.keys(REQUIRED_COLUMNS)]);
    const found = new Set(columns.rows.map(row => `${row.table_name}.${row.column_name}`));
    if (Object.entries(REQUIRED_COLUMNS).some(([table, required]) => required.some(column => !found.has(`${table}.${column}`)))) {
      return { status: "failed", reason: "required_schema_missing" };
    }
    // Exercise real object access/locks rather than trusting information_schema or a Boolean store.
    for (const table of Object.keys(REQUIRED_COLUMNS)) {
      if (cancelled()) throw new Error("Readiness request cancelled");
      await client.query(`SELECT 1 FROM public.${table} LIMIT 0`);
    }
    // Does not certify write privileges, constraints, index contents, or a production migration rollout.
    return { status: "ok" };
  }
}

function sameDatabase(first: string, second: string | undefined): boolean {
  if (!second) return false;
  try {
    const a = databasePoolOptions(first);
    const b = databasePoolOptions(second);
    // Same effective target, credentials and TLS policy; URL query options can alter the runtime.
    return a.connectionString === b.connectionString && JSON.stringify(a.ssl) === JSON.stringify(b.ssl);
  } catch { return false; }
}
