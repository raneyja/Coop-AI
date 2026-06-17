import type { Pool } from "pg";

const UPSERT_BATCH_SIZE = 100;

/** Above this, in-memory dependency graphs are skipped during indexing (search still uses Postgres). */
export const SYMBOL_EDGE_BUILD_LIMIT = 5_000;

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
    const deduped = dedupeSymbolRows(rows);
    if (deduped.length === 0) {
      return;
    }

    for (let offset = 0; offset < deduped.length; offset += UPSERT_BATCH_SIZE) {
      const batch = deduped.slice(offset, offset + UPSERT_BATCH_SIZE);
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
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (org_id, repo_id, symbol, file_path, line_start) DO UPDATE SET
           line_end = EXCLUDED.line_end,
           kind = EXCLUDED.kind,
           "references" = EXCLUDED."references",
           indexed_at = EXCLUDED.indexed_at`,
        values
      );
    }
  }

  public async loadCoveredFilePaths(orgId: string, repoId: string): Promise<Set<string>> {
    const result = await this.pool.query<{ file_path: string }>(
      `SELECT DISTINCT file_path
       FROM repo_symbol_index
       WHERE org_id = $1 AND repo_id = $2`,
      [orgId, repoId]
    );
    return new Set(result.rows.map((row) => String(row.file_path)));
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
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (index > 0 && index % 500 === 0) {
        const { yieldToEventLoop } = await import("./eventLoopYield");
        await yieldToEventLoop();
      }
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

export function dedupeSymbolRows(rows: SymbolIndexRow[]): SymbolIndexRow[] {
  if (rows.length <= 1) {
    return rows;
  }

  const byKey = new Map<string, SymbolIndexRow>();
  for (const row of rows) {
    const key = `${row.symbol}\0${row.filePath}\0${row.lineStart}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...row,
        references: mergeSymbolReferences(row.references, [])
      });
      continue;
    }
    byKey.set(key, {
      symbol: existing.symbol,
      filePath: existing.filePath,
      lineStart: existing.lineStart,
      lineEnd: Math.max(existing.lineEnd, row.lineEnd),
      kind: existing.kind,
      references: mergeSymbolReferences(existing.references, row.references)
    });
  }
  return [...byKey.values()];
}

export function mergeSymbolReferences(
  left: SymbolReferenceLocation[],
  right: SymbolReferenceLocation[]
): SymbolReferenceLocation[] {
  const seen = new Set<string>();
  const merged: SymbolReferenceLocation[] = [];
  for (const reference of [...left, ...right]) {
    const key = `${reference.file_path}\0${reference.line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(reference);
  }
  return merged;
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
