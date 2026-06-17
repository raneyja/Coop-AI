import assert from "node:assert/strict";
import { UserWorkspaceStore, workspaceRepoLimitForPlan } from "./userWorkspaceStore";

async function testWorkspaceRepoLimitForPlan() {
  assert.equal(workspaceRepoLimitForPlan("pro"), 3);
  assert.equal(workspaceRepoLimitForPlan("enterprise"), 3);
  assert.equal(workspaceRepoLimitForPlan("free"), null);
}

async function testSetUserWorkspaceReposEnforcesCap() {
  const rows: Array<{ org_id: string; user_id: string; repo_id: string; sort_order: number }> = [];
  const orgRepos = new Set(["github:a/b", "github:a/c", "github:a/d", "github:a/e"]);
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM org_repos")) {
        const ids = params?.[1] as string[];
        return { rows: ids.filter((id) => orgRepos.has(id)).map((repo_id) => ({ repo_id })) };
      }
      if (sql.startsWith("DELETE")) {
        const orgId = String(params?.[0]);
        const userId = String(params?.[1]);
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].org_id === orgId && rows[i].user_id === userId) {
            rows.splice(i, 1);
          }
        }
        return { rows: [] };
      }
      if (sql.startsWith("INSERT")) {
        rows.push({
          org_id: String(params?.[0]),
          user_id: String(params?.[1]),
          repo_id: String(params?.[2]),
          sort_order: Number(params?.[3])
        });
        return { rows: [] };
      }
      if (sql.includes("COUNT(*)")) {
        const orgId = String(params?.[0]);
        const userId = String(params?.[1]);
        const count = rows.filter((row) => row.org_id === orgId && row.user_id === userId).length;
        return { rows: [{ count }] };
      }
      if (sql.includes("ORDER BY sort_order")) {
        const orgId = String(params?.[0]);
        const userId = String(params?.[1]);
        return {
          rows: rows
            .filter((row) => row.org_id === orgId && row.user_id === userId)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((row) => ({
              org_id: row.org_id,
              user_id: row.user_id,
              repo_id: row.repo_id,
              sort_order: row.sort_order,
              created_at: new Date().toISOString()
            }))
        };
      }
      if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    connect: async () => ({
      query: pool.query,
      release: () => undefined
    })
  };

  const store = new UserWorkspaceStore(pool as never);
  await store.setUserWorkspaceRepos("org-1", "user-1", ["github:a/b", "github:a/c"], "pro");
  const quota = await store.getUserWorkspaceQuota("org-1", "user-1", "pro");
  assert.equal(quota.selectedCount, 2);
  assert.equal(quota.canAddMore, true);

  await assert.rejects(
    () =>
      store.setUserWorkspaceRepos(
        "org-1",
        "user-1",
        ["github:a/b", "github:a/c", "github:a/d", "github:a/e"],
        "pro"
      ),
    /at most 3/
  );
}

async function run() {
  await testWorkspaceRepoLimitForPlan();
  await testSetUserWorkspaceReposEnforcesCap();
  console.log("userWorkspaceStore: 2/2 tests passed");
}

void run();
