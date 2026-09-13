import test from "node:test";
import assert from "node:assert/strict";
import { exactIssueKeys, jobSearchActivityQuery, planJobSearchAttempts } from "./jobSearchPlan";

test("meaning-match treats a hyphen as the same idea and retries with the distinctive word", () => {
  const attempts = planJobSearchAttempts(["SQL-injection", "not to mix"]);
  assert.equal(attempts[0]?.kind, "phrase");
  assert.equal(attempts[0]?.text, "SQL injection");
  assert.equal(attempts[1]?.kind, "words");
  assert.equal(attempts[1]?.text, "injection");
  assert.ok(!attempts.some((attempt) => attempt.text.includes("-")));
});

test("ticket keys and file names are not rewritten into fuzzy text", () => {
  assert.deepEqual(exactIssueKeys(["do not mix COOP-403"]), ["COOP-403"]);
  const fileOnly = planJobSearchAttempts(["DateTimeUtils.java"]);
  assert.deepEqual(fileOnly, [{ kind: "exact", text: "DateTimeUtils.java", tokens: ["DateTimeUtils.java"] }]);
  const withPhrase = planJobSearchAttempts(["DateTimeUtils.java", "SQL-injection"]);
  assert.equal(withPhrase[0]?.text, "SQL injection");
  assert.ok(!withPhrase.some((attempt) => attempt.text.includes("DateTimeUtils")));
});

test("ticket keys stay exact even when mixed into a hyphenated phrase", () => {
  assert.deepEqual(exactIssueKeys(["SQL-injection COOP-403"]), ["COOP-403"]);
});

test("activity query matches the first job search attempt", () => {
  assert.equal(jobSearchActivityQuery(["SQL-injection"]), "SQL injection");
});
