import type { Pool } from "pg";

const UPSERT_BATCH_SIZE = 100;

export type SymbolReferenceLocation = {
  file_path: string;
  line: number;
};

export type SymbolIndexKind = "function" | "class" | "variable";

export type SymbolIndexRow = {
  symbol: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  kind: SymbolIndexKind;
  references: SymbolReferenceLocation[];
};

export type DependencyEdge = {
  from: string;
  to: string;
  type: "reference";
};

export class RepoSymbolIndexStore {
  public constructor(private readonly pool: Pool) {}

  public async countSymbols(orgId: string, repoId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM repo_symbol_index
       WHERE org_id = $1 AND repo_id = $2`,
      [orgId, repoId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async replaceIndex(
    orgId: string,
    repoId: string,
    rows: SymbolIndexRow[],
    indexedAt: Date
  ): Promise<void> {
    await this.pool.query(`DELETE FROM repo_symbol_index WHERE org_id = $1 AND repo_id = $2`, [
      orgId,
      repoId
    ]);
    if (rows.length === 0) {
      return;
    }

    for (let offset = 0; offset < rows.length; offset += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + UPSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let param = 1;
      for (const row of batch) {
        placeholders.push(
          `($${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}::jsonb, $${param++})`
        );
        values.push(
          orgId,
          repoId,
          row.symbol,
          row.filePath,
          row.lineStart,
          row.lineEnd,
          row.kind,
          JSON.stringify(row.references),
          indexedAt
        );
      }
      await this.pool.query(
        `INSERT INTO repo_symbol_index (
           org_id, repo_id, symbol, file_path, line_start, line_end, kind, "references", indexed_at
         )
         VALUES ${placeholders.join(", ")}`,
        values
      );
    }
  }

  public async loadRows(orgId: string, repoId: string): Promise<SymbolIndexRow[]> {
    const result = await this.pool.query<{
      symbol: string;
      file_path: string;
      line_start: number;
      line_end: number;
      kind: SymbolIndexKind;
      references: SymbolReferenceLocation[];
    }>(
      `SELECT symbol, file_path, line_start, line_end, kind, "references"
       FROM repo_symbol_index
       WHERE org_id = $1 AND repo_id = $2
       ORDER BY file_path, line_start`,
      [orgId, repoId]
    );
    return result.rows.map((row) => ({
      symbol: String(row.symbol),
      filePath: String(row.file_path),
      lineStart: Number(row.line_start),
      lineEnd: Number(row.line_end),
      kind: row.kind,
      references: normalizeReferences(row.references)
    }));
  }

  public async loadDependencyEdges(orgId: string, repoId: string): Promise<DependencyEdge[]> {
    const rows = await this.loadRows(orgId, repoId);
    const edges: DependencyEdge[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const reference of row.references) {
        if (!reference.file_path || reference.file_path === row.filePath) {
          continue;
        }
        const key = `${reference.file_path}->${row.filePath}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        edges.push({
          from: reference.file_path,
          to: row.filePath,
          type: "reference"
        });
      }
    }
    return edges;
  }
}

function normalizeReferences(value: unknown): SymbolReferenceLocation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const references: SymbolReferenceLocation[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const filePath = record.file_path ?? record.filePath;
    const line = record.line ?? record.line_start ?? record.lineStart;
    if (typeof filePath !== "string" || !filePath) {
      continue;
    }
    references.push({
      file_path: filePath,
      line: typeof line === "number" && Number.isFinite(line) ? line : 1
    });
  }
  return references;
}
