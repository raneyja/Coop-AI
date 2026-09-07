import assert from "node:assert/strict";
import { extractAgentSearchQuery, indexQueryForRetrieval } from "../api/agent/searchQuery";
import {
  extractOnboardingTopicQueries,
  expandBehaviouralIndexQueries,
  isDemotedDeclarationPath,
  isOnboardingNoisePath,
  isTypeDeclarationPath,
  isWeakIndexQuery,
  pickBehaviouralImplementationPaths,
  pickOnboardingTopicAttachPaths,
  onboardingIndexQueries,
  onboardingTopicsCovered,
  pathMatchesOnboardingTopic,
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
  const hunt = extractAgentSearchQuery(E1_ASK);
  assert.ok(hunt.length > 0 && hunt.length < E1_ASK.length, `hunt=${hunt}`);
  assert.ok(!/work items/i.test(hunt), `hunt should not be the full onboard ask: ${hunt}`);
  const retrieval = indexQueryForRetrieval(E1_ASK);
  assert.ok(retrieval.length < E1_ASK.length);
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

test("J7: tests never beat implementation files when ranking fail-opens", () => {
  const paths = [
    "src/webview/lib/chatProseParser.test.ts",
    "src/context/contextGatheringMessages.test.ts",
    "src/webview/components/ChatStream.tsx",
    "src/chat/CoopChatSession.ts",
    "src/chat/effectiveQuickAction.test.ts"
  ];
  const picked = selectOnboardingEvidencePaths(paths, "handleChat sendMessage send", 5);
  assert.ok(
    picked.includes("src/chat/CoopChatSession.ts"),
    `expected CoopChatSession in ${picked.join(", ")}`
  );
  assert.ok(
    picked.includes("src/webview/components/ChatStream.tsx"),
    `expected ChatStream in ${picked.join(", ")}`
  );
  assert.ok(
    !picked.some((path) => path.includes(".test.")),
    `tests leaked into first files: ${picked.join(", ")}`
  );
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

const T9_ASK =
  "I'm on-call for this service and I don't have it cloned. Where does the API create an issue, and what are the 4 files I should read first?";
const AUTH_API_ASK =
  "I'm on-call for this service. Where does the API reject a bad token, and what are the 4 files I should read first?";

test("on-call API create is not an on-call-for index query", () => {
  const topics = extractOnboardingTopicQueries(T9_ASK);
  assert.ok(!topics.some((t) => /on-call/i.test(t)), `topics=${JSON.stringify(topics)}`);
  assert.ok(isWeakIndexQuery("I'm on-call for"));
  const index = onboardingIndexQueries(T9_ASK);
  assert.ok(index.some((q) => /^issue$/i.test(q)), `expected issue in ${JSON.stringify(index)}`);
  assert.ok(
    index.some((q) => /serializer|views/i.test(q)),
    `expected serializer/views in ${JSON.stringify(index)}`
  );
});

test("API-layer paths beat issue-modal when the user asked the API", () => {
  const paths = [
    "apps/web/core/components/issues/issue-modal/base.tsx",
    "apps/web/core/store/issue/helpers/base-issues-utils.ts",
    "apps/api/app/serializers/issue.py",
    "apps/api/app/views/issue.py",
    "apps/api/db/models/issue.py"
  ];
  const query = onboardingIndexQueries(T9_ASK).join(" ");
  const picked = selectOnboardingEvidencePaths(paths, query, 4);
  assert.ok(
    picked.some((path) => /serializers\/issue\.py$/.test(path)),
    `serializer missing from ${picked.join(", ")}`
  );
  assert.ok(
    picked.some((path) => /views\/issue\.py$/.test(path) || /models\/issue\.py$/.test(path)),
    `view/model missing from ${picked.join(", ")}`
  );
  assert.ok(
    !picked.every((path) => /apps\/web\//.test(path)),
    `API ask must not be web-only: ${picked.join(", ")}`
  );
});

test("API ask with only frontend attached stays uncovered when API hits exist", () => {
  const uncovered = uncoveredOnboardingTopics({
    topicQueries: onboardingIndexQueries(T9_ASK),
    hitPaths: [
      "apps/web/core/components/issues/issue-modal/base.tsx",
      "apps/api/app/serializers/issue.py"
    ],
    attachedPaths: ["apps/web/core/components/issues/issue-modal/base.tsx"]
  });
  assert.ok(uncovered.length > 0, "frontend-only attach must not fail-open when API hits exist");
});

test("API reject-token onboard is the same job as create-issue", () => {
  const index = onboardingIndexQueries(AUTH_API_ASK);
  assert.ok(!index.some((q) => /on-call/i.test(q)));
  const picked = selectOnboardingEvidencePaths(
    [
      "apps/web/core/components/auth/login-modal.tsx",
      "apps/api/app/serializers/token.py",
      "apps/api/app/views/auth.py"
    ],
    index.join(" "),
    4
  );
  assert.ok(
    picked.some((path) => /apps\/api\//.test(path)),
    `API paths missing from ${picked.join(", ")}`
  );
});

const J7_ASK =
  "I'm new and I don't have this cloned. Where does a chat message get sent, and what are the 5 files I should read first?";

test("J7: onboard ask drops newcomer framing and indexes the action stem", () => {
  const topics = extractOnboardingTopicQueries(J7_ASK);
  assert.ok(!topics.some((t) => /i'?m new/i.test(t)), `topics=${JSON.stringify(topics)}`);
  assert.ok(!topics.some((t) => /\bget\b/i.test(t)), `auxiliary kept: ${JSON.stringify(topics)}`);
  const index = onboardingIndexQueries(J7_ASK);
  // handleChatSend is the symbol — "send" alone ranks ChatMessage / types.ts.
  assert.ok(
    index.some((q) => /handleChat|sendMessage|sendChat|send/i.test(q)),
    `expected send-path query in ${JSON.stringify(index)}`
  );
  assert.ok(
    expandBehaviouralIndexQueries("chat message sent").includes("handleChat"),
    "chat+sent must expand to handleChat"
  );
  assert.ok(index.length <= 3);
});

test("J7: types.ts does not lead a behavioural ask, but stays as context", () => {
  const query = "send chat message sent";
  assert.equal(isTypeDeclarationPath("src/chat/types.ts"), true);
  assert.equal(isTypeDeclarationPath("src/webview/types/index.d.ts"), true);
  assert.equal(isTypeDeclarationPath("src/chat/CoopChatSession.ts"), false);
  assert.equal(isDemotedDeclarationPath("src/chat/types.ts", query), true);

  const picked = selectOnboardingEvidencePaths(
    ["src/chat/types.ts", "src/chat/CoopChatSession.ts"],
    query,
    5
  );
  assert.equal(
    picked[0],
    "src/chat/CoopChatSession.ts",
    `send path must lead: ${picked.join(", ")}`
  );
  assert.ok(picked.includes("src/chat/types.ts"), "declarations stay available as context");
});

test("J7: an explicit types ask is never demoted", () => {
  for (const query of ["chat message types", "what interfaces describe a chat message", "types"]) {
    assert.equal(
      isDemotedDeclarationPath("src/chat/types.ts", query),
      false,
      `demoted on an explicit declaration ask: ${query}`
    );
  }
  const picked = selectOnboardingEvidencePaths(
    ["src/chat/CoopChatSession.ts", "src/chat/types.ts"],
    "types",
    5
  );
  assert.equal(picked[0], "src/chat/types.ts", `picked=${picked.join(", ")}`);
});

test("J7: demotion only applies to declaration files on behavioural asks", () => {
  assert.equal(isDemotedDeclarationPath("src/chat/CoopChatSession.ts", "send chat message"), false);
  assert.equal(isDemotedDeclarationPath("src/chat/types.ts", "who owns the chat module"), false);
  assert.equal(isDemotedDeclarationPath("src/chat/types.ts", "where is a message handled"), true);
});

test("J7: types-only attach is uncovered when send-path hits exist", () => {
  const uncovered = uncoveredOnboardingTopics({
    topicQueries: ["send", "chat message sent"],
    hitPaths: ["src/chat/types.ts", "src/chat/CoopChatSession.ts", "src/webview/components/ChatComposer.tsx"],
    attachedPaths: ["src/chat/types.ts"]
  });
  assert.ok(uncovered.length > 0, "declaration-only attach must not fail-open when implementation hits exist");
  const fetch = pickOnboardingTopicAttachPaths({
    topicQueries: ["send", "chat message sent"],
    hitPaths: ["src/chat/types.ts", "src/chat/CoopChatSession.ts", "src/webview/components/ChatComposer.tsx"],
    attachedPaths: ["src/chat/types.ts"]
  });
  assert.ok(
    fetch.includes("src/chat/CoopChatSession.ts"),
    `expected CoopChatSession in ${fetch.join(", ")}`
  );
  assert.ok(!fetch.includes("src/chat/types.ts"));
});

test("J7: behavioural attach skips types.ts when the hit list has an implementation file", () => {
  const picked = pickBehaviouralImplementationPaths({
    query: "send chat message sent",
    hitPaths: ["src/chat/types.ts", "src/chat/CoopChatSession.ts"],
    attachedPaths: ["src/chat/types.ts"],
    maxPaths: 4
  });
  assert.deepEqual(picked, ["src/chat/CoopChatSession.ts"]);
  assert.deepEqual(
    pickBehaviouralImplementationPaths({
      query: "send chat message sent",
      hitPaths: ["src/chat/types.ts", "src/chat/CoopChatSession.ts"],
      attachedPaths: ["src/chat/CoopChatSession.ts"]
    }),
    []
  );
});

const total = passed + failed;
console.log(`\nonboardingSearchQueries: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
