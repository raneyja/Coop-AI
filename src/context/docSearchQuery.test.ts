import assert from "node:assert/strict";
import {
  buildConfluenceCql,
  buildConfluenceRepoOnlyCql,
  buildRepoOrQuery,
  buildRepoSearchTerms,
  sanitizeAtlassianContainsTerm,
  decisionSearchPhrase,
  buildDecisionConfluenceCql
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

test("decisionSearchPhrase picks the longest sanitized decision term", () => {
  assert.equal(decisionSearchPhrase(["SQL-injection", "not to mix"]), "SQL injection");
  assert.equal(
    buildDecisionConfluenceCql(["SQL-injection", "not to mix"]),
    'type=page AND text ~ "SQL injection" ORDER BY lastModified DESC'
  );
});

test("sanitizeAtlassianContainsTerm strips hyphens and reserved words", () => {
  assert.equal(sanitizeAtlassianContainsTerm("SQL-injection"), "SQL injection");
  assert.equal(sanitizeAtlassianContainsTerm("not to mix"), "to mix");
  assert.equal(sanitizeAtlassianContainsTerm("coop-ai"), "coop ai");
  assert.equal(sanitizeAtlassianContainsTerm("training-java-monolith-refactor"), "training java monolith refactor");
  assert.equal(sanitizeAtlassianContainsTerm("github:acme/app"), "github:acme/app");
  assert.equal(sanitizeAtlassianContainsTerm("github:acme/coop-ai-core"), "github:acme/coop ai core");
  assert.equal(
    sanitizeAtlassianContainsTerm("coopai-group/training-java-monolith-refactor"),
    "coopai group/training java monolith refactor"
  );
});

test("buildConfluenceCql sanitizes hyphenated extras", () => {
  const cql = buildConfluenceCql("acme", "payments", ["SQL-injection", "not to mix"]);
  assert.ok(cql);
  assert.match(cql!, /SQL injection/);
  assert.match(cql!, /to mix/);
  assert.doesNotMatch(cql!, /SQL-injection|not to mix/);
});

test("buildConfluenceCql strips host prefixes that break CQL", () => {
  const cql = buildConfluenceCql("coopai-group", "training-java-monolith-refactor");
  assert.ok(cql);
  assert.doesNotMatch(cql!, /github:|gitlab:|bitbucket:/);
  assert.match(cql!, /training java monolith refactor/);
});

test("buildConfluenceCql extrasOnly skips hyphenated repo slugs", () => {
  const cql = buildConfluenceCql(
    "coopai-group",
    "training-java-monolith-refactor",
    ["SQL-injection"],
    { extrasOnly: true }
  );
  assert.ok(cql);
  assert.match(cql!, /SQL injection/);
  assert.doesNotMatch(cql!, /training-java|SQL-injection/);
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
