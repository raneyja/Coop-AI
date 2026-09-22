import type { Pool } from "pg";
import { GraphCache, type GraphCacheOptions, type RepositoryGraph } from "./graphCache";

type PersistOptions = GraphCacheOptions & {
  pool: Pool;
  orgId?: string;
};

type PendingPersist = {
  orgId: string;
  repoId: string;
};

let loggedMissingOrgPersist = false;

export class PersistingGraphCache extends GraphCache {
  private readonly pool: Pool;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingPersist = new Map<string, PendingPersist>();

  public constructor(options: PersistOptions) {
    super(options);
    this.pool = options.pool;
  }

  /**
   * Load one org into memory. Never reads another org's rows.
   * Startup does not hydrate the multi-tenant table.
   */
  public async hydrateOrg(orgId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT repo_id, payload FROM graph_snapshots WHERE org_id = $1`,
      [orgId]
    );
    for (const row of result.rows) {
      const graph = reviveGraph(parseJson(row.payload));
      if (graph) {
        super.setGraph(orgId, graph);
      }
    }
  }

  public override async ensureLoaded(orgId: string, repoId: string): Promise<void> {
    if (!orgId || super.getGraph(orgId, repoId)) {
      return;
    }
    const result = await this.pool.query(
      `SELECT payload FROM graph_snapshots WHERE org_id = $1 AND repo_id = $2`,
      [orgId, repoId]
    );
    const graph = reviveGraph(parseJson(result.rows[0]?.payload));
    if (graph) {
      super.setGraph(orgId, graph);
    }
  }

  public override setGraph(orgId: string, graph: RepositoryGraph): void {
    if (!orgId) {
      logSkipPersist(graph.repoId);
      return;
    }
    super.setGraph(orgId, graph);
    this.schedulePersist(orgId, graph.repoId);
  }

  public override upsertRepository(
    orgId: string,
    ref: Parameters<GraphCache["upsertRepository"]>[1],
    partial?: Parameters<GraphCache["upsertRepository"]>[2]
  ): RepositoryGraph {
    const graph = super.upsertRepository(orgId, ref, partial);
    if (orgId) {
      this.schedulePersist(orgId, graph.repoId);
    }
    return graph;
  }

  public override deleteGraph(orgId: string, repoId: string): boolean {
    const deleted = super.deleteGraph(orgId, repoId);
    this.pendingPersist.delete(`${orgId}\u0000${repoId}`);
    if (orgId) {
      void this.pool.query(`DELETE FROM graph_snapshots WHERE org_id = $1 AND repo_id = $2`, [
        orgId,
        repoId
      ]);
    }
    return deleted;
  }

  public async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    const pending = [...this.pendingPersist.values()];
    this.pendingPersist.clear();
    for (const item of pending) {
      await this.persistRepo(item.orgId, item.repoId);
    }
  }

  private schedulePersist(orgId: string, repoId: string): void {
    this.pendingPersist.set(`${orgId}\u0000${repoId}`, { orgId, repoId });
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      void this.flush();
    }, 250);
  }

  private async persistRepo(orgId: string, repoId: string): Promise<void> {
    if (!orgId) {
      logSkipPersist(repoId);
      return;
    }
    const graph = super.getGraph(orgId, repoId);
    if (!graph) {
      return;
    }
    await this.pool.query(
      `INSERT INTO graph_snapshots (org_id, repo_id, payload, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (org_id, repo_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
      [orgId, repoId, JSON.stringify(graph, dateReplacer)]
    );
  }
}

export async function createGraphCache(
  backend: "memory" | "postgres" | "redis" | "hybrid",
  options: GraphCacheOptions & { pool?: Pool | null; connectionString?: string }
): Promise<GraphCache> {
  if (backend === "postgres") {
    const pool = options.pool ?? (options.connectionString ? await import("../server/db").then((m) => m.getDbPool(options.connectionString)) : null);
    if (!pool) {
      throw new Error("GRAPH_CACHE_BACKEND=postgres requires DATABASE_URL");
    }
    // Do not hydrate every tenant into this process. Rows load on demand per org+repo.
    return new PersistingGraphCache({ ...options, pool });
  }
  return new GraphCache(options);
}

function logSkipPersist(repoId: string): void {
  if (loggedMissingOrgPersist) {
    return;
  }
  loggedMissingOrgPersist = true;
  console.warn(`[graph-cache] skip persist — missing orgId (first repo ${repoId})`);
}

function parseJson(value: unknown): unknown {
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return value;
}

function reviveGraph(value: unknown): RepositoryGraph | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const graph = value as RepositoryGraph;
  graph.lastUpdated = new Date(graph.lastUpdated);
  if (graph.metadata?.lastIndexedAt) {
    graph.metadata.lastIndexedAt = new Date(graph.metadata.lastIndexedAt);
  }
  graph.fileTree = (graph.fileTree ?? []).map((file) => ({
    ...file,
    lastModified: new Date(file.lastModified)
  }));
  graph.recentCommits = (graph.recentCommits ?? []).map((commit) => ({
    ...commit,
    date: new Date(commit.date)
  }));
  return graph;
}

function dateReplacer(_key: string, value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}
