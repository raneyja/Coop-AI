import assert from "node:assert/strict";
import { classifyError, normalizeJobError, redactSecretsFromErrorMessage } from "./errorHandling";

void (async () => {
  assert.equal(
    classifyError(new Error('duplicate key value violates unique constraint "repo_symbol_index_pkey"')),
    "permanent"
  );
  assert.equal(classifyError(new Error("429 rate limit exceeded")), "transient");

  const fakeGhsToken = `gh${"s"}_${"TEST_REDACTION_FIXTURE_NOT_A_REAL_SECRET"}`;
  const leaked = `git clone https://x-access-token:${fakeGhsToken}@github.com/o/r.git`;
  const redacted = redactSecretsFromErrorMessage(leaked);
  assert.ok(!redacted.includes(fakeGhsToken));
  assert.ok(redacted.includes("x-access-token:***@"));
  assert.equal(normalizeJobError(new Error(leaked)), redacted);

  console.log("errorHandling: 2/2 tests passed");
})();
