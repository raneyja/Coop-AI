import assert from "node:assert/strict";
import { lightningSearch, resolveSearchRepoIds } from "./lightningSearch";
import { buildZoektScopedQuery } from "./zoektShardIdentity";

const ORG = "org-1";
const OWNED = ["github:acme/api", "github:acme/web"];

function catalogPool(extra?: (sql: string, params: unknown[]) => { rows: unknown[] } | undefined) {
  return {
    query: async (sql: string, params: unknown[]) => {
      const custom = extra?.(sql, params);
      if (custom) {
        return custom;
      }
      if (sql.includes("lightning_enabled = true")) {
        assert.equal(params[0], ORG);
        return { rows: OWNED.map((repo_id) => ({ repo_id })) };
      }
      if (sql.includes("repo_id = ANY")) {
        assert.equal(params[0], ORG);
        const requested = params[1] as string[];
        return {
          rows: requested.filter((id) => OWNED.includes(id)).map((repo_id) => ({ repo_id }))
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

void (async () => {
  const pool = catalogPool();

  const indexed = await resolveSearchRepoIds(pool as never, ORG, {
    scope: "indexed",
    pattern: "handler"
  });
  assert.deepEqual(indexed, OWNED);

  const org = await resolveSearchRepoIds(pool as never, ORG, {
    scope: "org",
    pattern: "handler"
  });
  assert.deepEqual(org, OWNED);

  const single = await resolveSearchRepoIds(pool as never, ORG, {
    repoId: "github:acme/api",
    pattern: "handler"
  });
  assert.deepEqual(single, ["github:acme/api"]);

  const foreign = await resolveSearchRepoIds(pool as never, ORG, {
    repoId: "github:other/secret",
    pattern: "handler"
  });
  assert.deepEqual(foreign, []);

  const mixed = await resolveSearchRepoIds(pool as never, ORG, {
    userRepoIds: ["github:acme/api", "gitlab:other/secret", "bitbucket:other/secret"],
    pattern: "handler"
  });
  assert.deepEqual(mixed, ["github:acme/api"]);

  const perUserPool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("lightning_enabled = true")) {
        return {
          rows: [
            { repo_id: "github:acme/api" },
            { repo_id: "github:acme/web" }
          ]
        };
      }
      if (sql.includes("repo_id = ANY")) {
        return {
          rows: (params[1] as string[]).map((repo_id) => ({ repo_id }))
        };
      }
      if (sql.includes("FROM organizations")) {
        return {
          rows: [
            {
              id: ORG,
              name: "Org",
              plan: "pro",
              repo_access_mode: "per_user",
              created_at: new Date(),
              usage_tier: null
            }
          ]
        };
      }
      if (sql.includes("FROM org_repos") && !sql.includes("ANY")) {
        return {
          rows: ["github:acme/api", "github:acme/web"].map((repo_id) => ({
            org_id: ORG,
            repo_id,
            lightning_enabled: true,
            index_status: "ready",
            updated_at: new Date()
          }))
        };
      }
      if (sql.includes("user_repo_grants")) {
        assert.equal(params[1], "user-1");
        return { rows: [{ repo_id: "github:acme/api" }] };
      }
      throw new Error(`unexpected per-user query: ${sql}`);
    }
  };
  const granted = await resolveSearchRepoIds(perUserPool as never, ORG, {
    scope: "indexed",
    pattern: "handler",
    caller: { userId: "user-1", enforceUserGrants: true }
  });
  assert.deepEqual(granted, ["github:acme/api"]);

  const previousFetch = globalThis.fetch;
  const previousZoekt = process.env.ZOEKT_URL;
  const calls: string[] = [];
  process.env.ZOEKT_URL = "http://zoekt.test";
  globalThis.fetch = async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ result: { FileMatches: [] } }), { status: 200 });
  };
  try {
    calls.length = 0;
    const hidden = await lightningSearch(pool as never, ORG, {
      repoId: "github:other/secret",
      pattern: "token"
    });
    assert.equal(hidden.hits.length, 0);
    assert.equal(calls.length, 0, "Zoekt must not be queried for a foreign repoId");

    calls.length = 0;
    await lightningSearch(pool as never, ORG, {
      repoId: "github:acme/api",
      pattern: "token"
    });
    assert.equal(calls.length, 1);
    const query = new URL(calls[0]).searchParams.get("q") ?? "";
    assert.match(query, /^repo:/);
    assert.match(query, new RegExp(`${ORG}__github\\.com/acme/api`));
    assert.equal(query.includes("org-2__"), false);

    const orgA = buildZoektScopedQuery("org-a", "token", ["gitlab:acme/app"]);
    const orgBName = "org-b__gitlab.com/acme/app";
    assert.equal(orgA.includes(orgBName), false);
    assert.match(orgA, /org-a__gitlab\.com\/acme\/app/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousZoekt === undefined) {
      delete process.env.ZOEKT_URL;
    } else {
      process.env.ZOEKT_URL = previousZoekt;
    }
  }

  console.log("lightningSearchScope: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
