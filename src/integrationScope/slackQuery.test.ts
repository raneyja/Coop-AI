import test from "node:test";
import assert from "node:assert/strict";
import {
  applySlackChannelScope,
  filterSlackHitsByChannel,
  isSlackScopeBlocked
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

test("applySlackChannelScope appends in:channel filters", () => {
  const queries = applySlackChannelScope(["repo OR bug"], ["C123"], ["general"]);
  assert.equal(queries[0], "(repo OR bug) (in:C123 OR in:general)");
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
