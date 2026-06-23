import assert from "node:assert/strict";
import {
  extractSourceCitationInner,
  isSourceCitationLabel,
  matchSourceCitationLabel,
  normalizeSourceCitationLabel,
  sourceCitationAnchor,
  sourceCitationSlug
} from "./sourceCitationRegistry";

assert.equal(sourceCitationSlug("[Sources: PR #1506]"), "pr-1506");
assert.equal(sourceCitationSlug("GitHub commits & reviews"), "github-commits-reviews");
assert.equal(
  sourceCitationAnchor("abc123", "[Sources: Dependency graph]"),
  "artifact-abc123--dependency-graph"
);
assert.equal(extractSourceCitationInner("`[Sources: Slack search]`"), "Slack search");
assert.equal(isSourceCitationLabel("[Sources: Jira search]"), true);
assert.equal(normalizeSourceCitationLabel("Sources: GitHub"), "[Sources: GitHub]");
assert.equal(
  matchSourceCitationLabel("[Sources: pr 1506]", ["[Sources: PR #1506]"]),
  "[Sources: PR #1506]"
);

console.log("sourceCitationRegistry: ok");
