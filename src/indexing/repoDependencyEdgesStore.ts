import type { Pool } from "pg";

const INSERT_BATCH_SIZE = 100;

export type DependencyEdgeSource = "import-parse" | "scip" | "workspace";

export type RepoDependencyEdgeRow = {
  fromPath: string;
  toPath: string;
  kind: string;
  symbol?: string;
  line?: number;
  source: DependencyEdgeSource;
};

type DependencyEdgeDbRow = {
  from_path: string;
  to_path: string;
  kind: string;
  symbol: string | null;
  line: number;
  source: DependencyEdgeSource;
};

export class RepoDependencyEdgesStore {
  public constructor(private readonly pool: Pool) {}

  public async countEdges(orgId: string, repoId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM repo_dependency_edges
       WHERE org_id = $1 AND repo_id = $2`,
      [orgId, repoId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async replaceEdges(
    orgId: string,
    repoId: string,
    rows: RepoDependencyEdgeRow[],
    indexedAt: Date
  ): Promise<void> {
    const deduped = dedupeDependencyEdgeRows(rows);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM repo_dependency_edges WHERE org_id = $1 AND repo_id = $2`, [
        orgId,
        repoId
      ]);
      for (let offset = 0; offset < deduped.length; offset += INSERT_BATCH_SIZE) {
        const batch = deduped.slice(offset, offset + INSERT_BATCH_SIZE);
        const { placeholders, values } = buildInsertBatch(orgId, repoId, batch, indexedAt);
        await client.query(
          `INSERT INTO repo_dependency_edges (
             org_id, repo_id, from_path, to_path, kind, symbol, line, source, indexed_at
           )
           VALUES ${placeholders.join(", ")}`,
          values
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore rollback errors */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async loadDependentsForFile(
    orgId: string,
    repoId: string,
    filePath: string
  ): Promise<RepoDependencyEdgeRow[]> {
    const result = await this.pool.query<DependencyEdgeDbRow>(
      `SELECT from_path, to_path, kind, symbol, line, source
       FROM repo_dependency_edges
       WHERE org_id = $1 AND repo_id = $2 AND to_path = $3
       ORDER BY from_path, line`,
      [orgId, repoId, filePath]
    );
    return result.rows.map(mapDbRowToEdge);
  }

  public async loadEdgesSample(
    orgId: string,
    repoId: string,
    limit = 10
  ): Promise<RepoDependencyEdgeRow[]> {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    const result = await this.pool.query<DependencyEdgeDbRow>(
      `SELECT from_path, to_path, kind, symbol, line, source
       FROM repo_dependency_edges
       WHERE org_id = $1 AND repo_id = $2
       ORDER BY from_path, to_path, line
       LIMIT $3`,
      [orgId, repoId, safeLimit]
    );
    return result.rows.map(mapDbRowToEdge);
  }

  /** All edges for a repo (cache rebuild / full graph hydrate). */
  public async loadAllEdges(orgId: string, repoId: string): Promise<RepoDependencyEdgeRow[]> {
    const result = await this.pool.query<DependencyEdgeDbRow>(
      `SELECT from_path, to_path, kind, symbol, line, source
       FROM repo_dependency_edges
       WHERE org_id = $1 AND repo_id = $2
       ORDER BY from_path, to_path, line`,
      [orgId, repoId]
    );
    return result.rows.map(mapDbRowToEdge);
  }
}

export function buildInsertBatch(
  orgId: string,
  repoId: string,
  rows: RepoDependencyEdgeRow[],
  indexedAt: Date
): { placeholders: string[]; values: unknown[] } {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let param = 1;
  for (const row of rows) {
    placeholders.push(
      `($${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++})`
    );
    values.push(
      orgId,
      repoId,
      row.fromPath,
      row.toPath,
      row.kind,
      row.symbol ?? null,
      normalizeLine(row.line),
      row.source,
      indexedAt
    );
  }
  return { placeholders, values };
}

export function dedupeDependencyEdgeRows(rows: RepoDependencyEdgeRow[]): RepoDependencyEdgeRow[] {
  if (rows.length <= 1) {
    return rows;
  }

  const byKey = new Map<string, RepoDependencyEdgeRow>();
  for (const row of rows) {
    const key = `${row.fromPath}\0${row.toPath}\0${row.kind}\0${row.source}\0${normalizeLine(row.line)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    if (!existing.symbol && row.symbol) {
      byKey.set(key, { ...existing, symbol: row.symbol });
    }
  }
  return [...byKey.values()];
}

function normalizeLine(line: number | undefined): number {
  return typeof line === "number" && Number.isFinite(line) ? Math.trunc(line) : 0;
}

function mapDbRowToEdge(row: DependencyEdgeDbRow): RepoDependencyEdgeRow {
  const edge: RepoDependencyEdgeRow = {
    fromPath: String(row.from_path),
    toPath: String(row.to_path),
    kind: String(row.kind),
    source: row.source,
    line: Number(row.line)
  };
  if (row.symbol) {
    edge.symbol = String(row.symbol);
  }
  return edge;
}
