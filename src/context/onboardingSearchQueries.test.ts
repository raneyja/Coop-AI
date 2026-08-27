import assert from "node:assert/strict";
import { extractAgentSearchQuery, indexQueryForRetrieval } from "../api/agent/searchQuery";
import {
  extractOnboardingTopicQueries,
  isOnboardingNoisePath,
  isWeakIndexQuery,
  onboardingIndexQueries,
  onboardingTopicsCovered,
  pathMatchesOnboardingTopic,
  pickOnboardingTopicAttachPaths,
  selectOnboardingEvidencePaths,
  uncoveredOnboardingTopics
} from "./onboardingSearchQueries";

const E1_ASK =
  "/understand I'm new to this service and I don't have it cloned. Where does API auth live, how do work items and states flow, and what are the 5 files I should read first?".replace(
    /^\/understand\s+/i,
    ""
  );

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

test("E1 ask is not a lone this-service hunt query", () => {
  assert.equal(extractAgentSearchQuery(E1_ASK), "this service");
  assert.equal(indexQueryForRetrieval(E1_ASK), "this service");
  const topics = extractOnboardingTopicQueries(E1_ASK);
  assert.ok(topics.length >= 2, `topics=${JSON.stringify(topics)}`);
  assert.ok(
    topics.some((t) => /auth/i.test(t)),
    `expected auth in ${JSON.stringify(topics)}`
  );
  assert.ok(
    topics.some((t) => /work items?|issue|state/i.test(t)),
    `expected work items/states in ${JSON.stringify(topics)}`
  );
  assert.ok(topics.every((t) => !isWeakIndexQuery(t)));
  assert.ok(!topics.some((t) => /^this service$/i.test(t)));
  const index = onboardingIndexQueries(E1_ASK);
  assert.ok(index.length <= 3);
  assert.ok(index.every((q) => q.toLowerCase() !== "this service"));
  assert.ok(index.includes("authentication"), `expected authentication in ${JSON.stringify(index)}`);
  assert.ok(
    index.some((q) => /^issue$/i.test(q)),
    `expected issue in ${JSON.stringify(index)}`
  );
  assert.ok(
    index.some((q) => /^state$/i.test(q)),
    `expected state in ${JSON.stringify(index)}`
  );
});

test("isWeakIndexQuery catches hunt-shortening noise", () => {
  assert.equal(isWeakIndexQuery("this service"), true);
  assert.equal(isWeakIndexQuery("Focus"), true);
  assert.equal(isWeakIndexQuery("API auth"), false);
  assert.equal(isWeakIndexQuery("agent hunt loop"), false);
});

test("hunt locate still shortens requireAuth — onboarding helper is separate", () => {
  assert.equal(
    extractAgentSearchQuery("Where is requireAuth defined in this repo?"),
    "requireAuth"
  );
});

test("onboarding ranking prefers auth middleware and issue/state models over OpenAPI/seed/i18n", () => {
  const paths = [
    "apps/api/plane/settings/openapi.py",
    "apps/api/plane/seeds/data/issues.json",
    "apps/api/plane/bgtasks/workspace_seed_task.py",
    "packages/i18n/src/locales/en/workspace.json",
    "apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/[projectId]/states/page.tsx",
    "apps/api/plane/api/middleware/api_authentication.py",
    "apps/api/plane/db/models/issue.py",
    "apps/api/plane/db/models/state.py"
  ];
  const query = "authentication issue state";
  assert.equal(isOnboardingNoisePath("apps/api/plane/settings/openapi.py"), true);
  assert.equal(isOnboardingNoisePath("apps/api/plane/seeds/data/issues.json"), true);
  assert.equal(isOnboardingNoisePath("apps/api/plane/bgtasks/workspace_seed_task.py"), true);
  assert.equal(isOnboardingNoisePath("packages/i18n/src/locales/en/workspace.json"), true);
  assert.equal(
    isOnboardingNoisePath("apps/api/plane/api/middleware/api_authentication.py"),
    false
  );

  const picked = selectOnboardingEvidencePaths(paths, query, 5);
  assert.ok(
    picked.some((path) => path.includes("api_authentication.py")),
    `auth missing from ${picked.join(", ")}`
  );
  assert.ok(
    picked.some((path) => path.endsWith("issue.py")),
    `issue model missing from ${picked.join(", ")}`
  );
  assert.ok(
    picked.some((path) => path.endsWith("state.py")),
    `state model missing from ${picked.join(", ")}`
  );
  assert.ok(!picked.some((path) => /openapi|seeds\/|seed_task|locales\/|i18n\//.test(path)));
});

test("onboarding ranking fails open when every path is noise", () => {
  const paths = [
    "apps/api/plane/settings/openapi.py",
    "apps/api/plane/seeds/data/issues.json"
  ];
  const picked = selectOnboardingEvidencePaths(paths, "authentication issue state", 5);
  assert.deepEqual(picked, paths);
});

test("onboarding ranking spreads first files across auth/issue/state and drops tests/migrations", () => {
  const paths = [
    "apps/admin/components/authentication/authentication-method-card.tsx",
    "apps/api/plane/api/middleware/api_authentication.py",
    "apps/api/plane/app/middleware/api_authentication.py",
    "apps/api/plane/tests/contract/app/test_authentication.py",
    "apps/api/plane/db/migrations/0112_auto_20251124_0603.py",
    "apps/api/plane/db/models/issue.py",
    "apps/api/plane/db/models/state.py"
  ];
  assert.equal(
    isOnboardingNoisePath("apps/api/plane/tests/contract/app/test_authentication.py"),
    true
  );
  assert.equal(
    isOnboardingNoisePath("apps/api/plane/db/migrations/0112_auto_20251124_0603.py"),
    true
  );

  const picked = selectOnboardingEvidencePaths(paths, "authentication issue state", 5);
  assert.ok(
    picked.some((path) => path === "apps/api/plane/api/middleware/api_authentication.py"),
    `auth middleware missing from ${picked.join(", ")}`
  );
  assert.ok(
    picked.some((path) => path.endsWith("issue.py")),
    `issue model missing from ${picked.join(", ")}`
  );
  assert.ok(
    picked.some((path) => path.endsWith("state.py")),
    `state model missing from ${picked.join(", ")}`
  );
  assert.equal(
    picked.filter((path) => path.endsWith("api_authentication.py")).length,
    1,
    `duplicate auth files in ${picked.join(", ")}`
  );
  assert.ok(!picked.some((path) => /\/tests?\/|\/migrations?\//.test(path)));
});

const E1_TOPICS = ["authentication", "issue", "state"];
const AUTH = "apps/api/plane/api/middleware/api_authentication.py";
const ISSUE = "apps/api/plane/db/models/issue.py";
const STATE = "apps/api/plane/db/models/state.py";

test("onboardingTopicsCovered fails when issue/state hits exist but only auth is attached", () => {
  assert.equal(
    onboardingTopicsCovered({
      topicQueries: E1_TOPICS,
      hitPaths: [AUTH, ISSUE, STATE],
      attachedPaths: [AUTH]
    }),
    false
  );
  const uncovered = uncoveredOnboardingTopics({
    topicQueries: E1_TOPICS,
    hitPaths: [AUTH, ISSUE, STATE],
    attachedPaths: [AUTH]
  });
  assert.deepEqual(uncovered.sort(), ["issue", "state"]);
  const fetch = pickOnboardingTopicAttachPaths({
    topicQueries: E1_TOPICS,
    hitPaths: [AUTH, ISSUE, STATE],
    attachedPaths: [AUTH]
  });
  assert.ok(fetch.includes(ISSUE), `expected issue.py in ${fetch.join(", ")}`);
  assert.ok(fetch.includes(STATE), `expected state.py in ${fetch.join(", ")}`);
});

test("onboardingTopicsCovered passes when each topic with hits is attached", () => {
  assert.equal(
    onboardingTopicsCovered({
      topicQueries: E1_TOPICS,
      hitPaths: [AUTH, ISSUE, STATE],
      attachedPaths: [AUTH, ISSUE, STATE]
    }),
    true
  );
  assert.deepEqual(
    uncoveredOnboardingTopics({
      topicQueries: E1_TOPICS,
      hitPaths: [AUTH, ISSUE, STATE],
      attachedPaths: [AUTH, ISSUE, STATE]
    }),
    []
  );
});

test("onboardingTopicsCovered fails open when a topic has zero non-noise hits", () => {
  assert.equal(
    onboardingTopicsCovered({
      topicQueries: E1_TOPICS,
      hitPaths: [AUTH, "apps/api/plane/seeds/data/issues.json"],
      attachedPaths: [AUTH]
    }),
    true
  );
  assert.deepEqual(
    uncoveredOnboardingTopics({
      topicQueries: E1_TOPICS,
      hitPaths: [AUTH, "apps/api/plane/seeds/data/issues.json"],
      attachedPaths: [AUTH]
    }),
    []
  );
});

test("filename identity: empty-state and issue/archive do not beat state.py / issue.py", () => {
  const live = [
    AUTH,
    "apps/api/plane/app/views/issue/archive.py",
    "apps/api/plane/app/views/workspace/draft.py",
    "apps/admin/components/authentication/authentication-method-card.tsx",
    "apps/web/core/components/analytics/empty-state.tsx"
  ];
  assert.equal(pathMatchesOnboardingTopic(live[4], "state"), false);
  assert.equal(pathMatchesOnboardingTopic("apps/api/plane/db/models/state.py", "state"), true);
  assert.equal(pathMatchesOnboardingTopic("apps/api/plane/app/views/issue/archive.py", "issue"), true);
  assert.equal(pathMatchesOnboardingTopic(ISSUE, "issue"), true);

  const picked = selectOnboardingEvidencePaths([...live, ISSUE, STATE], "authentication issue state", 5);
  assert.ok(picked.some((path) => path.endsWith("api_authentication.py")));
  assert.ok(picked.includes(ISSUE), `issue.py missing from ${picked.join(", ")}`);
  assert.ok(picked.includes(STATE), `state.py missing from ${picked.join(", ")}`);
  assert.ok(!picked.some((path) => path.includes("empty-state")));
  assert.ok(!picked.some((path) => path.endsWith("archive.py")));

  const uncovered = uncoveredOnboardingTopics({
    topicQueries: E1_TOPICS,
    hitPaths: [...live, ISSUE, STATE],
    attachedPaths: live
  });
  assert.ok(uncovered.includes("state"), `empty-state must not cover state: ${JSON.stringify(uncovered)}`);
  assert.ok(uncovered.includes("issue"), `archive.py must not cover issue.py: ${JSON.stringify(uncovered)}`);
  const fetch = pickOnboardingTopicAttachPaths({
    topicQueries: E1_TOPICS,
    hitPaths: [...live, ISSUE, STATE],
    attachedPaths: live
  });
  assert.ok(fetch.includes(ISSUE));
  assert.ok(fetch.includes(STATE));
});

const total = passed + failed;
console.log(`\nonboardingSearchQueries: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
