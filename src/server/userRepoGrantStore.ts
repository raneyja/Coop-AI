import type { Pool } from "pg";

export type UserRepoGrantRecord = {
  orgId: string;
  userId: string;
  repoId: string;
  createdAt: Date;
};

export class UserRepoGrantStore {
  public constructor(private readonly pool: Pool) {}

  public async listUserRepoGrantIds(orgId: string, userId: string): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT repo_id FROM user_repo_grants
       WHERE org_id = $1 AND user_id = $2
       ORDER BY repo_id ASC`,
      [orgId, userId]
    );
    return result.rows.map((row) => String(row.repo_id));
  }

  public async listUserRepoGrants(orgId: string, userId: string): Promise<UserRepoGrantRecord[]> {
    const result = await this.pool.query(
      `SELECT org_id, user_id, repo_id, created_at
       FROM user_repo_grants
       WHERE org_id = $1 AND user_id = $2
       ORDER BY repo_id ASC`,
      [orgId, userId]
    );
    return result.rows.map(rowToRecord);
  }

  public async setUserRepoGrants(
    orgId: string,
    userId: string,
    repoIds: string[],
    options?: { validateAgainstOrgRepos?: (repoId: string) => Promise<boolean> }
  ): Promise<UserRepoGrantRecord[]> {
    const normalized = [...new Set(repoIds.map((id) => id.trim()).filter(Boolean))];
    if (options?.validateAgainstOrgRepos) {
      for (const repoId of normalized) {
        const known = await options.validateAgainstOrgRepos(repoId);
        if (!known) {
          throw new Error(`Repository is not in the organization catalog: ${repoId}`);
        }
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM user_repo_grants WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId
      ]);
      for (const repoId of normalized) {
        await client.query(
          `INSERT INTO user_repo_grants (org_id, user_id, repo_id)
           VALUES ($1, $2, $3)`,
          [orgId, userId, repoId]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.listUserRepoGrants(orgId, userId);
  }
}

function rowToRecord(row: Record<string, unknown>): UserRepoGrantRecord {
  return {
    orgId: String(row.org_id),
    userId: String(row.user_id),
    repoId: String(row.repo_id),
    createdAt: new Date(String(row.created_at))
  };
}
