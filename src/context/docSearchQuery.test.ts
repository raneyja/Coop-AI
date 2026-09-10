import assert from "node:assert/strict";
import {
  buildConfluenceCql,
  buildConfluenceRepoOnlyCql,
  buildRepoOrQuery,
  buildRepoSearchTerms
} from "./docSearchQuery";
import { CODE_HOST_PROVIDERS } from "../api/codeHosts/types";

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

test("buildConfluenceCql requires repo ∩ extras when both present", () => {
  const cql = buildConfluenceCql("acme", "payments", ["webhook delivery"]);
  assert.ok(cql);
  assert.ok(cql!.includes(") AND ("));
  assert.match(cql!, /payments/i);
  assert.match(cql!, /webhook delivery/i);
});

test("buildConfluenceCql falls back to OR when only repo terms exist", () => {
  const cql = buildConfluenceCql("acme", "payments", []);
  assert.ok(cql);
  assert.match(cql!, /payments/i);
  assert.ok(!cql!.includes(") AND ("));
});

test("buildConfluenceRepoOnlyCql ignores extras", () => {
  const cql = buildConfluenceRepoOnlyCql("acme", "payments");
  assert.ok(cql);
  assert.match(cql!, /payments/i);
  assert.ok(!/webhook/i.test(cql!));
});

test("buildRepoSearchTerms prefixes every shipped code host", () => {
  const terms = buildRepoSearchTerms("coopai-group", "training-java-monolith-refactor");
  for (const host of CODE_HOST_PROVIDERS) {
    assert.ok(
      terms.includes(`${host}:coopai-group/training-java-monolith-refactor`),
      `missing ${host}: prefix`
    );
  }
});

test("buildRepoSearchTerms does not prefix every hyphen/underscore mutation", () => {
  const terms = buildRepoSearchTerms("acme", "training-java-monolith-refactor");
  const prefixed = terms.filter((term) => term.includes(":"));
  assert.equal(prefixed.length, CODE_HOST_PROVIDERS.length);
  assert.ok(terms.includes("training_java_monolith_refactor"));
  assert.ok(!terms.includes("github:acme/training_java_monolith_refactor"));
});

test("buildRepoSearchTerms puts the Use-repo host first among prefixes", () => {
  const terms = buildRepoSearchTerms("acme", "app", { preferHost: "gitlab" });
  const prefixed = terms.filter((term) => term.includes(":"));
  assert.equal(prefixed[0], "gitlab:acme/app");
  assert.ok(prefixed.includes("github:acme/app"));
  assert.ok(prefixed.includes("bitbucket:acme/app"));
});

test("buildRepoOrQuery still joins extras with OR for non-CQL tools", () => {
  const q = buildRepoOrQuery("acme", "payments", ["signing"]);
  assert.ok(q?.includes("payments"));
  assert.ok(q?.includes("signing"));
  assert.ok(q?.includes(" OR "));
});

const total = passed + failed;
console.log(`\ndocSearchQuery: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
