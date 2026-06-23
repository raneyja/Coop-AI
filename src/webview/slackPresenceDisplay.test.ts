import assert from "node:assert/strict";
import type { OwnershipScore } from "../types/ownership";
import { buildSlackPresenceViewModel } from "./slackPresenceDisplay";

function score(owner: string, presence?: OwnershipScore["presence"]): OwnershipScore {
  return {
    owner,
    score: 10,
    tier: "secondary",
    commitCount: 1,
    reviewApprovals: 0,
    issueResolutions: 0,
    activityWeight: 1,
    role: "author",
    presence
  };
}

assert.equal(buildSlackPresenceViewModel([score("alice")]).showSection, false);

const allUnlinked = buildSlackPresenceViewModel([
  score("a", { state: "unknown", label: "Not linked" }),
  score("b", { state: "unknown", label: "Not linked" })
]);
assert.equal(allUnlinked.collapsedSummary, "Unavailable · 2 owners unmapped");
assert.ok(allUnlinked.detailLine?.includes("couldn't be matched"));

const oneCoopEightExternal = buildSlackPresenceViewModel([
  score("coopai-dev", { state: "active", label: "Active (2:30 PM PDT)", slackUserId: "U1" }),
  ...Array.from({ length: 8 }, (_, index) =>
    score(`external-${index}`, { state: "unknown", label: "Not linked" })
  )
]);
assert.equal(oneCoopEightExternal.collapsedSummary, "1/9 mapped · @coopai-dev active");
assert.equal(oneCoopEightExternal.detailLine, "8 others unmapped");
assert.equal(oneCoopEightExternal.resolvedEntries.length, 0);

const allResolved = buildSlackPresenceViewModel([
  score("a", { state: "active", label: "Active", slackUserId: "U1" }),
  score("b", { state: "active", label: "Active", slackUserId: "U2" })
]);
assert.equal(allResolved.collapsedSummary, "2 mapped in Slack");
assert.equal(allResolved.resolvedEntries.length, 2);

console.log("slackPresenceDisplay: ok");
