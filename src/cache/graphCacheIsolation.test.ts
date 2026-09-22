import assert from "node:assert/strict";
import { GraphCache, type RepositoryGraph } from "./graphCache";
import { PersistingGraphCache } from "./graphCachePostgres";

const repoId = "github:acme/app";

function graph(marker: string): RepositoryGraph {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    repoId,
    owner: "acme",
    repo: "app",
    lastUpdated: now,
    fileTree: [
      { path: marker, size: 1, lastModified: now, lastAuthor: "dev", sha: marker }
    ],
    dependencies: [],
    owners: [],
    recentCommits: [],
    pullRequests: [],
    issues: [],
    reviews: [],
    slackDecisions: [],
    branches: [],
    metadata: { language: "ts", lastIndexedAt: now, indexVersion: 1 }
  };
}

const memory = new GraphCache();
memory.setGraph("org-a", graph("a.ts"));
memory.setGraph("org-b", graph("b.ts"));
assert.equal(memory.getGraph("org-a", repoId)?.fileTree[0]?.path, "a.ts");
assert.equal(memory.getGraph("org-b", repoId)?.fileTree[0]?.path, "b.ts");
assert.equal(memory.deleteGraph("org-a", repoId), true);
assert.equal(memory.getGraph("org-a", repoId), undefined);
assert.equal(memory.getGraph("org-b", repoId)?.fileTree[0]?.path, "b.ts");

void (async () => {
const writes: Array<{ sql: string; params: unknown[] }> = [];
const stored = new Map<string, unknown>();
const pool = {
  query: async (sql: string, params: unknown[] = []) => {
    writes.push({ sql, params });
    if (sql.includes("INSERT INTO graph_snapshots")) {
      stored.set(`${params[0]}\u0000${params[1]}`, params[2]);
      return { rows: [] };
    }
    if (sql.includes("DELETE FROM graph_snapshots")) {
      stored.delete(`${params[0]}\u0000${params[1]}`);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM graph_snapshots") && sql.includes("SELECT")) {
      if (!sql.includes("WHERE org_id = $1")) {
        return {
          rows: [...stored.entries()].map(([key, payload]) => ({
            repo_id: key.split("\u0000")[1],
            payload
          }))
        };
      }
      const orgId = String(params[0]);
      const rows = [];
      for (const [key, payload] of stored) {
        if (!key.startsWith(`${orgId}\u0000`)) {
          continue;
        }
        rows.push({ repo_id: key.split("\u0000")[1], payload });
      }
      return { rows };
    }
    return { rows: [] };
  }
};

const durable = new PersistingGraphCache({ pool: pool as never });
durable.setGraph("org-a", graph("a.ts"));
durable.setGraph("org-b", graph("b.ts"));
await durable.flush();
const inserts = writes.filter((entry) => entry.sql.includes("INSERT INTO graph_snapshots"));
assert.equal(inserts.length, 2);
assert.equal(inserts[0]?.params[0], "org-a");
assert.equal(inserts[1]?.params[0], "org-b");
assert.match(inserts[0]?.sql ?? "", /ON CONFLICT \(org_id, repo_id\)/);
assert.equal(durable.deleteGraph("org-a", repoId), true);
assert.equal(durable.getGraph("org-b", repoId)?.fileTree[0]?.path, "b.ts");
assert.equal(stored.has(`org-b\u0000${repoId}`), true);
assert.equal(stored.has(`org-a\u0000${repoId}`), false);

const hydrated = new PersistingGraphCache({ pool: pool as never });
await hydrated.hydrateOrg("org-a");
assert.equal(hydrated.getGraph("org-a", repoId), undefined);
assert.equal(hydrated.getGraph("org-b", repoId), undefined);

console.log("graphCacheIsolation: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
