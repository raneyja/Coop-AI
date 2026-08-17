/**
 * Honesty gates — fail if we claim Agent just works but Settings still has a
 * toggle, or the hunt still cites live collab.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { emptyChatIntentPlan } from "../../chat/intentPlanner/types";
import { planChatIntentFromRules } from "../../chat/intentPlanner/planChatIntent";
import { shouldRunAgentToolLoop } from "../../chat/agentRouting";
import { agentStepsToActivity } from "../../webview/agentActivity";
import { HONESTY_GATE_IDS } from "./gates";
import { DOGFOOD_HUNT_QUESTION, DOGFOOD_HUNT_SEARCH_QUERY } from "./dogfoodContract";
import { extractAgentSearchQuery, pickSearchHitsToRead, selectChatEvidencePaths } from "./searchQuery";

/** Repo-agnostic sample paths. Ranking must not know one repository's folders. */
const API_PATH = "server/auth/require_auth.py";
const UI_PATH = "web/components/auth/login-form.tsx";
const BARREL_PATH = "packages/ui/src/index.ts";
const VENDOR_PATH = "node_modules/express/lib/router.js";

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

function readRepo(...parts: string[]): string {
  return fs.readFileSync(path.join(__dirname, "../../..", ...parts), "utf8");
}

test("H-G1 Settings has no AgentMode on/off control", () => {
  const ui = readRepo("src/webview/components/settings/SettingsDetailViews.tsx");
  assert.doesNotMatch(ui, /title="AgentMode"/);
  assert.doesNotMatch(ui, /draft\.agentMode/);
  assert.ok(HONESTY_GATE_IDS.includes("H-G1"));
});

test("H-G2 send does not read a user agentMode setting", () => {
  const client = readRepo("src/chat/SecureApiClient.ts");
  assert.doesNotMatch(client, /readAgentModeSetting/);
  assert.doesNotMatch(client, /chat\.agentMode/);

  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.doesNotMatch(session, /readAgentModeSetting/);
  assert.doesNotMatch(session, /agentModeSetting/);
  assert.match(session, /const \{ autocompleteEnabled, \.\.\.rest \} = message\.payload/);

  const types = readRepo("src/chat/types.ts");
  assert.doesNotMatch(types, /agentMode:/);
});

test("H-G3 no coopAI.chat.agentMode contribution; hunts are always on", () => {
  const pkg = JSON.parse(readRepo("package.json")) as {
    contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
  };
  assert.equal(pkg.contributes.configuration.properties["coopAI.chat.agentMode"], undefined);

  const settingsView = readRepo("src/webview/SettingsView.tsx");
  assert.doesNotMatch(settingsView, /agentMode:/);

  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.doesNotMatch(session, /agentMode:/);
});

test("H-G4 dogfood hunt always loops (real planner, not empty plan)", () => {
  const plan = planChatIntentFromRules({
    message: DOGFOOD_HUNT_QUESTION,
    connectedTools: []
  });
  assert.equal(
    shouldRunAgentToolLoop({
      query: DOGFOOD_HUNT_QUESTION,
      hasQuickAction: false,
      intentPlan: plan
    }),
    true
  );
});

test("H-G5 dogfood hunt searches a short symbol, never the whole question", () => {
  const extracted = extractAgentSearchQuery(DOGFOOD_HUNT_QUESTION);
  assert.equal(extracted, DOGFOOD_HUNT_SEARCH_QUERY);
  assert.notEqual(extracted, DOGFOOD_HUNT_QUESTION);
  assert.ok(extracted.split(/\s+/).length <= 4);
});

test("H-G6 ranking prefers a path matching the question and drops structural noise", () => {
  const picked = pickSearchHitsToRead(
    [
      { fileName: BARREL_PATH, lineNumber: 1, score: 1 },
      { fileName: VENDOR_PATH, lineNumber: 1, score: 1 },
      { fileName: API_PATH, lineNumber: 12, score: 1 }
    ],
    2,
    DOGFOOD_HUNT_QUESTION
  );
  assert.equal(picked[0]?.fileName, API_PATH);
  assert.equal(
    picked.some((hit) => hit.fileName === BARREL_PATH || hit.fileName === VENDOR_PATH),
    false
  );
});

test("H-G7 loop posts activity from the agent-owned answer path", () => {
  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.match(session, /type: "agent:activity"/);
  assert.match(session, /runAgentOwnedTurn/);
  assert.match(session, /streamAgentAnswer/);

  const activity = agentStepsToActivity([
    { index: 0, tool: "search_code", summary: `search_code: ${DOGFOOD_HUNT_SEARCH_QUERY}`, completed: true },
    { index: 1, tool: "read_file", summary: `read_file: ${API_PATH}`, completed: true }
  ]);
  assert.match(activity.todos[0]?.content ?? "", /Searched/);
  assert.match(activity.todos[1]?.content ?? "", /Read/);
});

test("H-G8 no Agent toggle in Workflows header or composer (UX-G9)", () => {
  const chat = readRepo("src/webview/ChatPanel.tsx");
  const workflows = readRepo("src/webview/components/WorkflowsMenu.tsx");
  assert.doesNotMatch(chat, /AgentMode/);
  assert.doesNotMatch(chat, /Agent for repo questions/);
  assert.doesNotMatch(chat, /Agent for repo hunts/);
  assert.doesNotMatch(chat, /agentMode/);
  assert.doesNotMatch(workflows, /AgentMode/);
  assert.doesNotMatch(workflows, /Agent for repo questions/);
  assert.doesNotMatch(workflows, /Agent for repo hunts/);
  assert.doesNotMatch(workflows, /agentMode/);
});

test("H-G9 leftover Blast/Owner chips must not steal the dogfood hunt", () => {
  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.match(session, /shouldSuppressSuggestChipsForAgentHunt/);
  assert.match(session, /emptyChatIntentPlan\(message\)/);

  assert.equal(
    shouldRunAgentToolLoop({
      query: DOGFOOD_HUNT_QUESTION,
      hasQuickAction: false,
      intentPlan: emptyChatIntentPlan(DOGFOOD_HUNT_QUESTION)
    }),
    true
  );
});

test("H-G10 docs do not tell the user to enable AgentMode", () => {
  const arch = readRepo("docs/llm-prompt-architecture.md");
  assert.match(arch, /always on|no user toggle|no Agent setting/i);
  assert.doesNotMatch(arch, /defaults to \*\*off\*\*/);

  const dogfood = readRepo("docs/agent-dogfood.md");
  assert.match(dogfood, /no Coop Settings toggle|No Coop Settings toggle/i);
  assert.match(dogfood, /search_jira|mid-loop|Jira/i);
});

test("H-G11 retrieval is one rule for every ask — no repo names, no layer special cases", () => {
  const source = readRepo("src/api/agent/searchQuery.ts");
  for (const repoSpecific of [/apps\/live/, /hocuspocus/, /auth-forms/, /apps\/space/]) {
    assert.doesNotMatch(source, repoSpecific);
  }

  const named = selectChatEvidencePaths([UI_PATH, API_PATH], DOGFOOD_HUNT_QUESTION, 3);
  assert.equal(named[0], API_PATH);
  assert.equal(named.includes(UI_PATH), false);

  const broad = selectChatEvidencePaths(
    [UI_PATH, API_PATH],
    "How does authentication work across the codebase?",
    3
  );
  assert.equal(broad.includes(UI_PATH), true);
  assert.equal(broad.includes(API_PATH), true);

  const ui = selectChatEvidencePaths(
    [API_PATH, UI_PATH],
    "Where is the login form component defined?",
    3
  );
  assert.equal(ui[0], UI_PATH);
});

test("H-G12 hot path merges agent patch before Apply card (not orphan helpers)", () => {
  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.match(session, /mergeAnswerWithAgentPatch/);
  assert.match(session, /extractAgentProposedPatchText/);
  assert.match(session, /handlePatchComplete/);
});

test("H-G13 agent-owned answer still bridges propose_patch to Apply", () => {
  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.match(session, /runAgentOwnedTurn/);
  assert.match(session, /mergeAnswerWithAgentPatch/);
  const prompts = readRepo("src/prompts/systemPrompts.ts");
  assert.match(prompts, /agent_proposed_patch/);
});

console.log(`\nhonesty.gates: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
