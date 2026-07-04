import assert from "node:assert/strict";
import { buildRepoId } from "./buildRepoId";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("buildRepoId uses preferences owner and repo", () => {
  assert.equal(
    buildRepoId({ owner: "acme", repo: "app", defaultCodeHost: "github" }),
    "github:acme/app"
  );
});

test("buildRepoId prefers context owner and repo when provided", () => {
  assert.equal(
    buildRepoId(
      { owner: "acme", repo: "app", defaultCodeHost: "github" },
      { owner: "other", repo: "service", provider: "gitlab" }
    ),
    "gitlab:other/service"
  );
});

test("buildRepoId returns unknown placeholder when owner or repo missing", () => {
  assert.equal(
    buildRepoId({ owner: "", repo: "app", defaultCodeHost: "github" }),
    "github:unknown/unknown"
  );
  assert.equal(
    buildRepoId({ owner: "acme", repo: "", defaultCodeHost: "github" }),
    "github:unknown/unknown"
  );
});

console.log(`\nbuildRepoId: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
