import assert from "node:assert/strict";
import {
  parseCodeHostProvider,
  resolveCodeHostProvider,
  resolveRepoCoordinates
} from "./types";

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

test("parseCodeHostProvider never invents GitHub", () => {
  assert.equal(parseCodeHostProvider("gitlab"), "gitlab");
  assert.equal(parseCodeHostProvider("GitHub"), "github");
  assert.equal(parseCodeHostProvider("gitlab:acme/app"), "gitlab");
  assert.equal(parseCodeHostProvider("acme/app"), undefined);
  assert.equal(parseCodeHostProvider(undefined), undefined);
});

test("resolveCodeHostProvider uses provider or prefixed repo id", () => {
  assert.equal(resolveCodeHostProvider({ provider: "bitbucket" }), "bitbucket");
  assert.equal(resolveCodeHostProvider({ repoId: "gitlab:group/app" }), "gitlab");
  assert.equal(resolveCodeHostProvider({ repoId: "acme/app" }), undefined);
  assert.equal(resolveCodeHostProvider({ repoId: "acme/app", provider: "gitlab" }), "gitlab");
});

test("resolveRepoCoordinates does not prefix unprefixed ids as GitHub", () => {
  assert.equal(resolveRepoCoordinates({ repoId: "acme/app" }), undefined);
  assert.deepEqual(resolveRepoCoordinates({ repoId: "acme/app", provider: "gitlab" }), {
    provider: "gitlab",
    owner: "acme",
    repo: "app",
    branch: undefined
  });
  assert.deepEqual(resolveRepoCoordinates({ repoId: "gitlab:group/sub/app", branch: "main" }), {
    provider: "gitlab",
    owner: "group",
    repo: "sub/app",
    branch: "main"
  });
});

const total = passed + failed;
console.log(`\ncodeHost types: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
