import assert from "node:assert/strict";
import test from "node:test";
import { pullRequestLinkLabel } from "./DecisionTimeline";

test("PR label names only an exact GitHub HTTPS pull-request URL", () => {
  assert.equal(pullRequestLinkLabel("https://github.com/acme/repo/pull/42"), "View on acme/repo");
  for (const url of [
    "https://github.com.attacker.invalid/acme/repo/pull/42",
    "https://attacker.invalid/github.com/acme/repo/pull/42",
    "http://github.com/acme/repo/pull/42",
    "https://user@github.com/acme/repo/pull/42",
    "https://github.com/acme/repo/issues/42"
  ]) {
    assert.equal(pullRequestLinkLabel(url), "View PR");
  }
});
