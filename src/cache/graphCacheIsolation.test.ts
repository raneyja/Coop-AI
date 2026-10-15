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
const heads=new Map<string,{requested_generation:string;published_generation:string;revision:string;tombstone:boolean;origin:string}>();
const pool = {
  connect:async()=>({query:pool.query,release:()=>undefined}),
  query: async (sql: string, params: unknown[] = []):Promise<{rows:Record<string,unknown>[];rowCount?:number}> => {
    writes.push({ sql, params });
    const key=String(params[0])+"\u0000"+String(params[1]);
    if(sql.includes('INSERT INTO graph_publication_heads')) {
      if(!heads.has(key))heads.set(key,{requested_generation:'0',published_generation:'0',revision:'0',tombstone:false,origin:'legacy-unattested'});
    }
    if(sql.includes('SELECT * FROM graph_publication_heads'))return {rows:heads.has(key)?[{...heads.get(key)}]:[]};
    if(sql.includes('UPDATE graph_publication_heads')) {
      heads.set(key,{requested_generation:String(params[2]),published_generation:String(params[2]),revision:String(params[3]),tombstone:Boolean(params[4]),origin:String(params[5])});
    }
    if (sql.includes("INSERT INTO graph_snapshots")) {
      stored.set(key,params[2]);return {rows:[]};
    }
    if (sql.includes("DELETE FROM graph_snapshots")) {
      stored.delete(key);return {rows:[],rowCount:1};
    }
    if(sql.includes('SELECT repo_id FROM graph_publication_heads'))return {rows:[...heads.keys()]
      .filter(key=>key.startsWith(String(params[0])+'\u0000')).map(key=>({repo_id:key.split('\u0000')[1]}))};
    if(sql.includes('LEFT JOIN graph_snapshots'))return {rows:heads.has(key)?[{...heads.get(key),payload:stored.get(key)}]:[]};
    return {rows:[]};
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
assert.match(inserts[0]?.sql ?? "", /ON CONFLICT\s*\(org_id,\s*repo_id\)/);
assert.equal(durable.deleteGraph("org-a", repoId), true);
await durable.flush(); // Public mutation stays synchronous; persistence is explicitly awaited.
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
