import test from "node:test";
import assert from "node:assert/strict";
import {
  filterTeamsHitsByChannel,
  isTeamsScopeBlocked,
  teamsScopeBlockMessage
} from "./teamsQuery";
import type { ResolvedIntegrationScope } from "./types";

test("isTeamsScopeBlocked is false when scope is not enforced", () => {
  const scope: ResolvedIntegrationScope = {
    provider: "teams",
    enforced: false,
    allowed: true,
    scopeStatus: "none"
  };
  assert.equal(isTeamsScopeBlocked(scope), false);
});

test("isTeamsScopeBlocked is true when enforced with no channels", () => {
  const scope: ResolvedIntegrationScope = {
    provider: "teams",
    enforced: true,
    allowed: false,
    scopeStatus: "required",
    reason: "Pick Teams channels in the admin portal."
  };
  assert.equal(isTeamsScopeBlocked(scope), true);
  assert.match(teamsScopeBlockMessage(scope), /Pick Teams channels/);
});

test("filterTeamsHitsByChannel keeps only allowlisted channels", () => {
  const hits = [
    { channelId: "19:one", body: "a" },
    { channelId: "19:two", body: "b" }
  ];
  const filtered = filterTeamsHitsByChannel(hits, new Set(["19:one"]));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.channelId, "19:one");
});
