import type { Pool } from "pg";
import type { ManifestFileEntry, ManifestSymbol } from "./types";

const UPSERT_BATCH_SIZE = 100;

export class RepoManifestStore {
  public constructor(private readonly pool: Pool) {}

  public async loadManifest(orgId: string, repoId: string): Promise<ManifestFileEntry[]> {
    const result = await this.pool.query<{ file_path: string; symbols: ManifestSymbol[] }>(
      `SELECT file_path, symbols
       FROM repo_manifests
       WHERE org_id = $1 AND repo_id = $2
       ORDER BY file_path`,
      [orgId, repoId]
    );
    return result.rows.map((row) => ({
      filePath: String(row.file_path),
      symbols: Array.isArray(row.symbols) ? row.symbols : []
    }));
  }

  public async upsertManifestRows(
    orgId: string,
    repoId: string,
    rows: ManifestFileEntry[],
    crawledAt: Date
  ): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + UPSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let param = 1;
      for (const row of batch) {
        placeholders.push(
          `($${param++}, $${param++}, $${param++}, $${param++}::jsonb, $${param++})`
        );
        values.push(orgId, repoId, row.filePath, JSON.stringify(row.symbols), crawledAt);
      }
      await this.pool.query(
        `INSERT INTO repo_manifests (org_id, repo_id, file_path, symbols, last_crawled_at)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (org_id, repo_id, file_path) DO UPDATE SET
           symbols = EXCLUDED.symbols,
           last_crawled_at = EXCLUDED.last_crawled_at`,
        values
      );
    }
  }

  public async deletePathsNotInSet(orgId: string, repoId: string, paths: string[]): Promise<void> {
    if (paths.length === 0) {
      await this.pool.query(`DELETE FROM repo_manifests WHERE org_id = $1 AND repo_id = $2`, [
        orgId,
        repoId
      ]);
      return;
    }
    await this.pool.query(
      `DELETE FROM repo_manifests
       WHERE org_id = $1 AND repo_id = $2
         AND NOT (file_path = ANY($3::text[]))`,
      [orgId, repoId, paths]
    );
  }
}
