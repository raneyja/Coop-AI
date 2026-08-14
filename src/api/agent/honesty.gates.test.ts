/**
 * Honesty gates — fail if we claim the agent is dogfood-ready but Jon cannot
 * turn it on in Coop Settings, or the hunt still cites live collab.
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

test("H-G1 Coop Settings owns the Agent switch (not only vscode Settings)", () => {
  const ui = readRepo("src/webview/components/settings/SettingsDetailViews.tsx");
  const agentRow = ui.match(
    /<SettingsCheckboxRow\s+title="AgentMode"[\s\S]*?\/>/
  )?.[0];
  assert.ok(agentRow, "AgentMode checkbox row missing");
  assert.doesNotMatch(agentRow!, /\bdescription=/);
  assert.match(ui, /checked=\{draft\.agentMode === "on"\}/);
  assert.match(ui, /agentMode: draft\.agentMode/);
  assert.ok(HONESTY_GATE_IDS.includes("H-G1"));
});

test("H-G2 Save writes chat.agentMode; send reads it live; settings:update does not drop it", () => {
  const client = readRepo("src/chat/SecureApiClient.ts");
  assert.match(client, /agentMode: readAgentModeSetting\(\)/);
  assert.match(client, /\["chat\.agentMode"/);

  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.match(session, /agentModeSetting: readAgentModeSetting\(\)/);
  assert.match(session, /const \{ autocompleteEnabled, \.\.\.rest \} = message\.payload/);
  assert.doesNotMatch(session, /const \{ autocompleteEnabled,\s*agentMode/);

  const types = readRepo("src/chat/types.ts");
  assert.match(types, /agentMode: "off" \| "auto" \| "on"/);
});

test("H-G3 default is still off — dogfood without turning it on must be today’s chat", () => {
  const pkg = JSON.parse(readRepo("package.json")) as {
    contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
  };
  assert.equal(pkg.contributes.configuration.properties["coopAI.chat.agentMode"]?.default, "off");

  const settingsView = readRepo("src/webview/SettingsView.tsx");
  assert.match(settingsView, /agentMode: "off"/);

  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.match(session, /agentMode: "off"/);

  const config = readRepo("src/config/agentModeConfig.ts");
  assert.match(config, /get<string>\("agentMode", "off"\)/);
});

test("H-G4 dogfood hunt loops only when Agent is on (real planner, not empty plan)", () => {
  const plan = planChatIntentFromRules({
    message: DOGFOOD_HUNT_QUESTION,
    connectedTools: []
  });
  assert.equal(
    shouldRunAgentToolLoop({
      query: DOGFOOD_HUNT_QUESTION,
      hasQuickAction: false,
      agentModeSetting: "on",
      intentPlan: plan
    }),
    true
  );
  assert.equal(
    shouldRunAgentToolLoop({
      query: DOGFOOD_HUNT_QUESTION,
      hasQuickAction: false,
      agentModeSetting: "off",
      intentPlan: plan
    }),
    false
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

test("H-G7 loop posts activity; UI shows Searched/Read (silent normal chat is a fail)", () => {
  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.match(session, /type: "agent:activity"/);
  assert.match(session, /enrichWithAgentToolsIfEnabled/);

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

test("H-G9 leftover Blast/Owner chips must not steal the dogfood hunt when Agent is on", () => {
  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.match(session, /shouldSuppressSuggestChipsForAgentHunt/);
  assert.match(session, /emptyChatIntentPlan\(message\)/);

  assert.equal(
    shouldRunAgentToolLoop({
      query: DOGFOOD_HUNT_QUESTION,
      hasQuickAction: false,
      agentModeSetting: "on",
      intentPlan: emptyChatIntentPlan(DOGFOOD_HUNT_QUESTION)
    }),
    true
  );
});

test("H-G10 dogfood instructions name Coop Settings Model & chat, not only the vscode key", () => {
  const plan = readRepo("docs/agent-ship-loop-build-plan.md");
  assert.match(plan, /AgentMode/);
  assert.match(plan, /Model & chat/);
  assert.match(plan, /Coop Settings/);
});

test("H-G11 retrieval is one rule for every ask — no repo names, no layer special cases", () => {
  const source = readRepo("src/api/agent/searchQuery.ts");
  for (const repoSpecific of [/apps\/live/, /hocuspocus/, /auth-forms/, /apps\/space/]) {
    assert.doesNotMatch(source, repoSpecific);
  }

  // A backend-sounding ask ranks the API path first but must not delete the UI path:
  // dropping a whole class of files is how we lost the real answer.
  const backend = selectChatEvidencePaths([UI_PATH, API_PATH], DOGFOOD_HUNT_QUESTION, 3);
  assert.equal(backend[0], API_PATH);
  assert.equal(backend.includes(UI_PATH), true);

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

test("H-G13 synthesis sees validated propose_patch text", () => {
  const prompts = readRepo("src/prompts/systemPrompts.ts");
  assert.match(prompts, /agent_proposed_patch/);
  assert.match(prompts, /extractAgentProposedPatch/);
});

console.log(`\nhonesty.gates: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
