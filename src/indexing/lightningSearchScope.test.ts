import assert from "node:assert/strict";
import { resolveSearchRepoIds } from "./lightningSearch";

void (async () => {
  const enabledRows = [{ repo_id: "github:acme/api" }, { repo_id: "github:acme/web" }];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("lightning_enabled = true")) {
        assert.equal(params[0], "org-1");
        return { rows: enabledRows };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };

  const indexed = await resolveSearchRepoIds(pool as never, "org-1", {
    scope: "indexed",
    pattern: "handler"
  });
  assert.deepEqual(indexed, ["github:acme/api", "github:acme/web"]);

  const org = await resolveSearchRepoIds(pool as never, "org-1", {
    scope: "org",
    pattern: "handler"
  });
  assert.deepEqual(org, ["github:acme/api", "github:acme/web"]);

  const single = await resolveSearchRepoIds(pool as never, "org-1", {
    repoId: "github:acme/api",
    pattern: "handler"
  });
  assert.deepEqual(single, ["github:acme/api"]);

  console.log("lightningSearchScope: 1/1 tests passed");
})();
