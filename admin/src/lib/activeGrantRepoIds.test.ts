import assert from "node:assert/strict";
import { activeGrantRepoIds } from "./activeGrantRepoIds";
import type { OrgRepoRecord } from "./coopApi";

const grants = ["github:old/a", "github:live/b", "github:old/c"];
const repos: OrgRepoRecord[] = [
  { repoId: "github:live/b", lightningEnabled: true, indexStatus: "ready" },
  { repoId: "github:disabled/d", lightningEnabled: false, indexStatus: "disabled" }
];

assert.deepEqual(
  activeGrantRepoIds(grants, repos),
  ["github:live/b"],
  "drops grants for repos that are no longer Deep-Indexed"
);

assert.deepEqual(
  activeGrantRepoIds(["github:only/orphan"], []),
  [],
  "empty indexed catalog clears all grants from the selection set"
);

console.log("activeGrantRepoIds.test.ts: ok");
