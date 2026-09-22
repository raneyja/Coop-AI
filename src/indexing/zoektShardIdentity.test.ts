import assert from "node:assert/strict";
import {
  buildZoektRepoFilter,
  buildZoektScopedQuery,
  zoektRepoName,
  zoektShardFilePrefix
} from "./zoektShardIdentity";

const repo = "github:acme/app";
const orgA = "11111111-1111-1111-1111-111111111111";
const orgB = "22222222-2222-2222-2222-222222222222";

assert.notEqual(zoektRepoName(orgA, repo), zoektRepoName(orgB, repo));
assert.notEqual(zoektShardFilePrefix(orgA, repo), zoektShardFilePrefix(orgB, repo));
assert.match(zoektRepoName(orgA, "gitlab:acme/app"), /^11111111-1111-1111-1111-111111111111__gitlab\.com\/acme\/app$/);
assert.match(
  zoektRepoName(orgA, "bitbucket:acme/app"),
  /^11111111-1111-1111-1111-111111111111__bitbucket\.org\/acme\/app$/
);

const filterA = buildZoektRepoFilter(orgA, [repo, "gitlab:acme/app"]);
assert.match(filterA, new RegExp(orgA));
assert.equal(filterA.includes(orgB), false);
assert.equal(buildZoektScopedQuery(orgA, "main", []).length, 0);
assert.equal(buildZoektScopedQuery("", "main", [repo]).length, 0);

const shard = zoektShardFilePrefix(orgA, repo);
assert.equal(shard.includes("/"), false);
assert.match(shard, /%2F/);

console.log("zoektShardIdentity: ok");
