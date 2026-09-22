import assert from "node:assert/strict";
import { GraphQueryApi } from "../api/graphQuery";
import { GraphCache } from "../cache/graphCache";
import { handleGraphHttp } from "./graphHttp";

const secret = "github:acme/secret";

class SpyCache extends GraphCache {
  public reads: string[] = [];

  public override getGraph(orgId: string, repoId: string) {
    this.reads.push(`get:${orgId}:${repoId}`);
    return super.getGraph(orgId, repoId);
  }

  public override getFileTree(orgId: string, repoId: string) {
    this.reads.push(`tree:${orgId}:${repoId}`);
    return super.getFileTree(orgId, repoId);
  }

  public override async ensureLoaded(orgId: string, repoId: string): Promise<void> {
    this.reads.push(`load:${orgId}:${repoId}`);
    await super.ensureLoaded(orgId, repoId);
  }
}

const pool = {
  query: async (sql: string) => {
    if (sql.includes("org_repos") || sql.includes("graph_snapshots") || sql.includes("repo_dependency")) {
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  }
};

void (async () => {
const previousFetch = globalThis.fetch;
const previousZoekt = process.env.ZOEKT_URL;
process.env.ZOEKT_URL = "http://zoekt.test";
let zoektCalls = 0;
globalThis.fetch = async () => {
  zoektCalls += 1;
  return new Response(JSON.stringify({ result: { FileMatches: [] } }), { status: 200 });
};

try {
  const cache = new SpyCache();
  cache.setGraph("org-a", {
    repoId: secret,
    owner: "acme",
    repo: "secret",
    lastUpdated: new Date(),
    fileTree: [
      {
        path: "secret.ts",
        size: 1,
        lastModified: new Date(),
        lastAuthor: "a",
        sha: "a"
      }
    ],
    dependencies: [],
    owners: [],
    recentCommits: [],
    pullRequests: [],
    issues: [],
    reviews: [],
    slackDecisions: [],
    branches: [],
    metadata: { language: "ts", lastIndexedAt: new Date(), indexVersion: 1 }
  });

  const search = await handleGraphHttp({
    pathname: `/graph/${encodeURIComponent(secret)}/search`,
    searchParams: new URLSearchParams({ pattern: "x" }),
    orgId: "org-b",
    pool: pool as never,
    cache,
    graphQuery: new GraphQueryApi({ cache })
  });
  assert.equal(search.statusCode, 404);
  assert.equal(zoektCalls, 0);
  assert.equal(cache.reads.length, 0);
  assert.equal(JSON.stringify(search.body).includes("secret.ts"), false);

  const tree = await handleGraphHttp({
    pathname: `/graph/${encodeURIComponent(secret)}/tree`,
    searchParams: new URLSearchParams(),
    orgId: "org-b",
    pool: pool as never,
    cache,
    graphQuery: new GraphQueryApi({ cache })
  });
  assert.equal(tree.statusCode, 404);
  assert.equal(cache.reads.length, 0);
  assert.equal(JSON.stringify(tree.body).includes("secret.ts"), false);
} finally {
  globalThis.fetch = previousFetch;
  if (previousZoekt === undefined) {
    delete process.env.ZOEKT_URL;
  } else {
    process.env.ZOEKT_URL = previousZoekt;
  }
}

console.log("graphRouteIsolation: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
