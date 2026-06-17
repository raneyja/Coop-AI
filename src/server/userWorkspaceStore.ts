import type { Pool } from "pg";
import type { OrgPlan } from "./orgStore";

export const USER_WORKSPACE_REPO_LIMIT = 3;

export type UserWorkspaceRepoRecord = {
  orgId: string;
  userId: string;
  repoId: string;
  sortOrder: number;
  createdAt: Date;
};

export type UserWorkspaceQuota = {
  selectedCount: number;
  limit: number | null;
  canAddMore: boolean;
  primaryRepoId?: string;
};

export function workspaceRepoLimitForPlan(plan: OrgPlan): number | null {
  if (plan === "pro" || plan === "enterprise") {
    return USER_WORKSPACE_REPO_LIMIT;
  }
  return null;
}

export class UserWorkspaceStore {
  public constructor(private readonly pool: Pool) {}

  public async listUserWorkspaceRepos(orgId: string, userId: string): Promise<UserWorkspaceRepoRecord[]> {
    const result = await this.pool.query(
      `SELECT org_id, user_id, repo_id, sort_order, created_at
       FROM user_workspace_repos
       WHERE org_id = $1 AND user_id = $2
       ORDER BY sort_order ASC, created_at ASC`,
      [orgId, userId]
    );
    return result.rows.map(rowToRecord);
  }

  public async countUserWorkspaceRepos(orgId: string, userId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM user_workspace_repos WHERE org_id = $1 AND user_id = $2`,
      [orgId, userId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async getUserWorkspaceQuota(
    orgId: string,
    userId: string,
    plan: OrgPlan
  ): Promise<UserWorkspaceQuota> {
    const repos = await this.listUserWorkspaceRepos(orgId, userId);
    const limit = workspaceRepoLimitForPlan(plan);
    return {
      selectedCount: repos.length,
      limit,
      canAddMore: limit === null || repos.length < limit,
      primaryRepoId: repos[0]?.repoId
    };
  }

  public async setUserWorkspaceRepos(
    orgId: string,
    userId: string,
    repoIds: string[],
    plan: OrgPlan
  ): Promise<UserWorkspaceRepoRecord[]> {
    const limit = workspaceRepoLimitForPlan(plan);
    const normalized = [...new Set(repoIds.map((id) => id.trim()).filter(Boolean))];
    if (limit !== null && normalized.length > limit) {
      throw new Error(`You can select at most ${limit} workspace repos.`);
    }

    if (normalized.length > 0) {
      const existing = await this.pool.query(
        `SELECT repo_id FROM org_repos WHERE org_id = $1 AND repo_id = ANY($2::varchar[])`,
        [orgId, normalized]
      );
      const known = new Set(existing.rows.map((row) => String(row.repo_id)));
      const missing = normalized.filter((repoId) => !known.has(repoId));
      if (missing.length > 0) {
        throw new Error(
          `These repos are not in your organization's indexed catalog yet: ${missing.join(", ")}`
        );
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM user_workspace_repos WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId
      ]);
      for (let index = 0; index < normalized.length; index += 1) {
        await client.query(
          `INSERT INTO user_workspace_repos (org_id, user_id, repo_id, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [orgId, userId, normalized[index], index]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.listUserWorkspaceRepos(orgId, userId);
  }

  public async listUserWorkspaceRepoIds(orgId: string, userId: string): Promise<string[]> {
    const repos = await this.listUserWorkspaceRepos(orgId, userId);
    return repos.map((repo) => repo.repoId);
  }
}

function rowToRecord(row: Record<string, unknown>): UserWorkspaceRepoRecord {
  return {
    orgId: String(row.org_id),
    userId: String(row.user_id),
    repoId: String(row.repo_id),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: new Date(String(row.created_at))
  };
}
