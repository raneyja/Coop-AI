import test from "node:test";
import assert from "node:assert/strict";
import {
  applySlackChannelScope,
  filterSlackHitsByChannel,
  isSlackScopeBlocked,
  scopeJobSlackSearchQueries,
  stripSlackSearchOperators
} from "./slackQuery";
import type { ResolvedIntegrationScope } from "./types";

test("isSlackScopeBlocked is false when scope is not enforced", () => {
  const scope: ResolvedIntegrationScope = {
    provider: "slack",
    enforced: false,
    allowed: true,
    scopeStatus: "none"
  };
  assert.equal(isSlackScopeBlocked(scope), false);
});

test("applySlackChannelScope fans out one in:<#id> query per channel", () => {
  const queries = applySlackChannelScope(["SQL injection"], ["C123", "C456"], ["general"]);
  assert.deepEqual(queries, ["SQL injection in:<#C123>", "SQL injection in:<#C456>"]);
});

test("stripSlackSearchOperators removes channel redirects but keeps the meaning", () => {
  assert.equal(
    stripSlackSearchOperators('SQL injection in:#secret from:<@U1> has:link is:thread in:"secret channel"'),
    "SQL injection"
  );
  assert.equal(stripSlackSearchOperators("injection"), "injection");
  assert.equal(stripSlackSearchOperators("COOP-403 in:#secret"), "COOP-403");
});

test("scopeJobSlackSearchQueries never sends an unscoped job query", () => {
  const scoped = scopeJobSlackSearchQueries(
    ["SQL injection", "injection"],
    ["C1", "C2", "C3"],
    ["a", "b", "c"],
    { enforced: true }
  );
  assert.deepEqual(scoped, ["SQL injection in:<#C1>", "SQL injection in:<#C2>"]);
  assert.deepEqual(
    scopeJobSlackSearchQueries(["SQL injection"], [], [], { enforced: true }),
    []
  );
  assert.deepEqual(
    scopeJobSlackSearchQueries(["SQL injection"], ["C1"], ["eng"], { enforced: false }),
    ["SQL injection"]
  );
  assert.deepEqual(
    scopeJobSlackSearchQueries([""], ["C9"], [], { enforced: true, allowEmpty: true }),
    ["in:<#C9>"]
  );
});

test("filterSlackHitsByChannel keeps only allowlisted channels", () => {
  const hits = [
    { channelId: "C1", text: "a" },
    { channelId: "C2", text: "b" }
  ];
  const filtered = filterSlackHitsByChannel(hits, new Set(["C1"]));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.channelId, "C1");
});
