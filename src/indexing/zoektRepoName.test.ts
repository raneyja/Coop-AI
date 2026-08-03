import assert from "node:assert/strict";
import { zoektHostRepoName, zoektRepoName, zoektRepoNameCandidates } from "./zoektRepoName";

void (async () => {
  assert.equal(zoektHostRepoName("github:acme/api"), "github.com/acme/api");
  assert.equal(zoektRepoName("org-1", "github:acme/api"), "org-1/github.com/acme/api");
  assert.deepEqual(zoektRepoNameCandidates("org-1", "github:acme/api"), [
    "org-1/github.com/acme/api",
    "github.com/acme/api"
  ]);
  console.log("zoektRepoName: 1/1 tests passed");
})();
