import type { Pool } from "pg";

export type RepoStatsRecord = {
  branch?: string;
  fileCount: number;
  lineCount: number;
  byteCount: number;
  languages: string[];
  headCommit?: string;
  indexedAt: Date;
};

export type StoredRepoStats = Omit<RepoStatsRecord, "indexedAt"> & { indexedAt: string };

/** Durable repository facts written by INDEX_REPOSITORY. Counts only — no source bodies. */
export class RepoStatsStore {
  public constructor(private readonly pool: Pool) {}

  public async upsertStats(orgId: string, repoId: string, stats: RepoStatsRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO repo_stats (
         org_id, repo_id, branch, file_count, line_count, byte_count, languages, head_commit, indexed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT (org_id, repo_id) DO UPDATE SET
         branch = EXCLUDED.branch,
         file_count = EXCLUDED.file_count,
         line_count = EXCLUDED.line_count,
         byte_count = EXCLUDED.byte_count,
         languages = EXCLUDED.languages,
         head_commit = EXCLUDED.head_commit,
         indexed_at = EXCLUDED.indexed_at`,
      [
        orgId,
        repoId,
        stats.branch ?? null,
        stats.fileCount,
        stats.lineCount,
        stats.byteCount,
        JSON.stringify(stats.languages ?? []),
        stats.headCommit ?? null,
        stats.indexedAt
      ]
    );
  }

  public async loadStats(orgId: string, repoId: string): Promise<StoredRepoStats | undefined> {
    const result = await this.pool.query<{
      branch: string | null;
      file_count: number | string;
      line_count: number | string;
      byte_count: number | string;
      languages: unknown;
      head_commit: string | null;
      indexed_at: Date;
    }>(
      `SELECT branch, file_count, line_count, byte_count, languages, head_commit, indexed_at
       FROM repo_stats
       WHERE org_id = $1 AND repo_id = $2`,
      [orgId, repoId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return {
      branch: row.branch ?? undefined,
      fileCount: Number(row.file_count),
      // BIGINT arrives as a string from pg.
      lineCount: Number(row.line_count),
      byteCount: Number(row.byte_count),
      languages: Array.isArray(row.languages) ? (row.languages as string[]) : [],
      headCommit: row.head_commit ?? undefined,
      indexedAt: new Date(row.indexed_at).toISOString()
    };
  }
}
