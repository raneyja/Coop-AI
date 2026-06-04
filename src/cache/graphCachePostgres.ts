import type { Pool } from "pg";
import { GraphCache, type GraphCacheOptions, type RepositoryGraph } from "./graphCache";

type PersistOptions = GraphCacheOptions & {
  pool: Pool;
  orgId?: string;
};

export class PersistingGraphCache extends GraphCache {
  private readonly pool: Pool;
  private readonly defaultOrgId?: string;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(options: PersistOptions) {
    super(options);
    this.pool = options.pool;
    this.defaultOrgId = options.orgId;
  }

  public async hydrate(): Promise<void> {
    const result = await this.pool.query(`SELECT repo_id, payload FROM graph_snapshots`);
    for (const row of result.rows) {
      const graph = reviveGraph(parseJson(row.payload));
      if (graph) {
        super.setGraph(graph);
      }
    }
  }

  public override setGraph(graph: RepositoryGraph): void {
    super.setGraph(graph);
    void this.schedulePersist(graph.repoId);
  }

  public override upsertRepository(
    ref: Parameters<GraphCache["upsertRepository"]>[0],
    partial?: Parameters<GraphCache["upsertRepository"]>[1]
  ): RepositoryGraph {
    const graph = super.upsertRepository(ref, partial);
    void this.schedulePersist(graph.repoId);
    return graph;
  }

  public override deleteGraph(repoId: string): boolean {
    const deleted = super.deleteGraph(repoId);
    if (deleted) {
      void this.pool.query(`DELETE FROM graph_snapshots WHERE repo_id = $1`, [repoId]);
    }
    return deleted;
  }

  private schedulePersist(repoId: string): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      void this.persistRepo(repoId);
    }, 250);
  }

  private async persistRepo(repoId: string): Promise<void> {
    const graph = super.getGraph(repoId);
    if (!graph) {
      return;
    }
    await this.pool.query(
      `INSERT INTO graph_snapshots (repo_id, org_id, payload, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (repo_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         org_id = COALESCE(EXCLUDED.org_id, graph_snapshots.org_id),
         updated_at = NOW()`,
      [repoId, this.defaultOrgId ?? null, JSON.stringify(graph, dateReplacer)]
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
    const cache = new PersistingGraphCache({ ...options, pool });
    await cache.hydrate();
    return cache;
  }
  return new GraphCache(options);
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
