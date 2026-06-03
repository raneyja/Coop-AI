import type { Pool } from "pg";

const INSERT_BATCH_SIZE = 100;

export type EmbeddingInsertRow = {
  filePath: string;
  chunkIndex: number;
  chunkText: string;
  embedding: number[];
};

export type SimilarChunkHit = {
  repoId: string;
  filePath: string;
  chunkIndex: number;
  chunkText: string;
  score: number;
};

export class RepoEmbeddingsStore {
  public constructor(private readonly pool: Pool) {}

  public async countChunks(orgId: string, repoId: string): Promise<number> {
    return this.countChunksForRepos(orgId, [repoId]);
  }

  public async countChunksForRepos(orgId: string, repoIds: string[]): Promise<number> {
    if (repoIds.length === 0) {
      return 0;
    }
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM repo_embeddings
       WHERE org_id = $1 AND repo_id = ANY($2::varchar[])`,
      [orgId, repoIds]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async replaceForRepo(
    orgId: string,
    repoId: string,
    rows: EmbeddingInsertRow[],
    createdAt: Date
  ): Promise<void> {
    await this.pool.query(`DELETE FROM repo_embeddings WHERE org_id = $1 AND repo_id = $2`, [
      orgId,
      repoId
    ]);
    if (rows.length === 0) {
      return;
    }

    for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let param = 1;
      for (const row of batch) {
        placeholders.push(
          `($${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}::vector, $${param++})`
        );
        values.push(
          orgId,
          repoId,
          row.filePath,
          row.chunkIndex,
          row.chunkText,
          formatVector(row.embedding),
          createdAt
        );
      }
      await this.pool.query(
        `INSERT INTO repo_embeddings (
           org_id, repo_id, file_path, chunk_index, chunk_text, embedding, created_at
         )
         VALUES ${placeholders.join(", ")}`,
        values
      );
    }
  }

  public async searchSimilar(
    orgId: string,
    repoId: string,
    queryEmbedding: number[],
    limit = 20
  ): Promise<SimilarChunkHit[]> {
    return this.searchSimilarAcrossRepos(orgId, [repoId], queryEmbedding, limit);
  }

  public async searchSimilarAcrossRepos(
    orgId: string,
    repoIds: string[],
    queryEmbedding: number[],
    limit = 20
  ): Promise<SimilarChunkHit[]> {
    if (repoIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<{
      repo_id: string;
      file_path: string;
      chunk_index: number;
      chunk_text: string;
      score: number;
    }>(
      `SELECT
         repo_id,
         file_path,
         chunk_index,
         chunk_text,
         1 - (embedding <=> $3::vector) AS score
       FROM repo_embeddings
       WHERE org_id = $1 AND repo_id = ANY($2::varchar[])
       ORDER BY embedding <=> $3::vector
       LIMIT $4`,
      [orgId, repoIds, formatVector(queryEmbedding), limit]
    );
    return result.rows.map((row) => ({
      repoId: String(row.repo_id),
      filePath: String(row.file_path),
      chunkIndex: Number(row.chunk_index),
      chunkText: String(row.chunk_text),
      score: Number(row.score)
    }));
  }
}

function formatVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
