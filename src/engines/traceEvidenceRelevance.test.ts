import assert from "node:assert/strict";
import {
  buildSlackSearchQueries,
  extractGitHubIssueNumbers,
  fileStemFromPath,
  integrationRelevanceFromHit,
  isIntegrationSearchHitRelevant,
  isNoiseIntegrationHit,
  parseGithubPullUrl,
  textReferencesGitHubIssues,
  textReferencesPr,
  threadMeetsRelevanceBar
} from "./traceEvidenceRelevance";

assert.deepEqual(parseGithubPullUrl("https://github.com/fastify/fastify/pull/1506"), {
  owner: "fastify",
  repo: "fastify"
});

const prBody =
  "Related: https://github.com/fastify/fastify/issues/1475 and https://github.com/fastify/fastify/issues/1503";
assert.deepEqual(extractGitHubIssueNumbers(prBody, 1506).sort(), [1475, 1503]);

const queries = buildSlackSearchQueries({
  prNumber: 1506,
  prTitle: "Chore: refactor fastify.js (#1506)",
  prBody,
  pullOwner: "fastify",
  pullRepo: "fastify"
});
assert.ok(queries.includes("github.com/fastify/fastify/pull/1506"));
assert.ok(queries.includes("github.com/fastify/fastify/issues/1475"));
assert.ok(queries.includes("Chore: refactor fastify.js"));

const prOptions = {
  prNumber: 1506,
  file: "lib/server.js",
  issueKeys: [] as string[],
  githubIssueNumbers: [1475, 1503]
};
assert.equal(isIntegrationSearchHitRelevant("Discussing #1475 before merge", prOptions), true);
assert.equal(textReferencesGitHubIssues("see issues/1503 for follow-up", [1503]), true);

assert.equal(textReferencesPr("Shipped in PR #1506", 1506), true);
assert.equal(textReferencesPr("see pull/1506 for context", 1506), true);
assert.equal(textReferencesPr("merged pr 1506 yesterday", 1506), true);
assert.equal(textReferencesPr("PR #15060 is unrelated", 1506), false);

const basicPrOptions = { prNumber: 1506, file: "lib/fastify.js", issueKeys: [] as string[] };
assert.equal(isIntegrationSearchHitRelevant("Review PR #1506 before merge", basicPrOptions), true);
assert.equal(isIntegrationSearchHitRelevant("Default archaeology queries for test bot", basicPrOptions), false);
assert.equal(
  isIntegrationSearchHitRelevant("Random standup notes with enough characters here", basicPrOptions),
  false
);
assert.equal(isIntegrationSearchHitRelevant("Refactor fastify.js module layout", basicPrOptions), true);

const issueOptions = { file: "lib/logger.js", issueKeys: ["FAST-42"] };
assert.equal(isIntegrationSearchHitRelevant("FAST-42 rollout plan", issueOptions), true);
assert.equal(isIntegrationSearchHitRelevant("logger.js naming discussion", issueOptions), true);
assert.equal(isIntegrationSearchHitRelevant("unrelated channel chatter", issueOptions), false);

assert.equal(
  threadMeetsRelevanceBar(
    [{ text: "Kickoff" }, { text: "Let's merge PR #1506 after CI passes" }],
    basicPrOptions
  ),
  true
);
assert.equal(threadMeetsRelevanceBar([{ text: "Kickoff" }, { text: "LGTM" }], basicPrOptions), false);

assert.equal(integrationRelevanceFromHit("Rename fastify.js entrypoint", "lib/fastify.js"), "direct");
assert.equal(integrationRelevanceFromHit("PR #1506 looks good", "lib/fastify.js"), "linked");

assert.equal(isNoiseIntegrationHit("Default archaeology queries for Coop AI test bot"), true);
assert.equal(isNoiseIntegrationHit("PR #1506 refactor discussion"), false);

assert.equal(fileStemFromPath("lib/server/fastify.js"), "fastify");

console.log("traceEvidenceRelevance.test.ts passed");
