import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAgentExploration } from "../webview/agentActivity";
import {
  appendTurnThinkingChunk,
  attachChatTurnActivity,
  buildChatTurnActivity,
  completeActivityView,
  formatThoughtLabel,
  formatWorkedForLabel,
  hasChatTurnActivity,
  isConcreteActivityLine,
  looksLikeRepoPath,
  recordTurnActivityLine,
  recordTurnAgentSteps,
  type ChatTurnActivityAccumulator
} from "./chatTurnActivity";
import { buildModelHistory } from "./buildModelHistory";
import type { ChatMessage } from "./types";

function accumulator(overrides: Partial<ChatTurnActivityAccumulator> = {}): ChatTurnActivityAccumulator {
  return {
    startedAt: 1_000,
    ...overrides
  };
}

test("buildChatTurnActivity persists thinking and hunt steps", () => {
  const turn = accumulator();
  appendTurnThinkingChunk(turn, "Need to read auth.ts ", 1_200);
  appendTurnThinkingChunk(turn, "then search callers.", 2_200);
  recordTurnAgentSteps(turn, [
    { index: 0, tool: "search_code", summary: "search_code: login", completed: true },
    { index: 1, tool: "read_file", summary: "read_file: src/auth.ts", completed: false }
  ]);

  const activity = buildChatTurnActivity(turn, 1_000 + 179_000);
  assert.ok(activity);
  assert.equal(activity.thinkingText, "Need to read auth.ts then search callers.");
  assert.equal(activity.thinkingMs, 1_000);
  assert.equal(activity.durationMs, 179_000);
  assert.equal(activity.tools.length, 2);
  assert.ok(activity.tools.every((tool) => tool.status === "done"));
  assert.ok(activity.steps?.every((step) => step.status === "completed"));
  assert.ok(activity.files.some((file) => file.path === "src/auth.ts"));
});

test("buildChatTurnActivity strips rotating processing terms and synthesis filler", () => {
  const turn = accumulator();
  recordTurnActivityLine(turn, "Processing context…");
  recordTurnActivityLine(turn, "Weighing gathered evidence…");
  recordTurnActivityLine(turn, "Preparing answer…");
  recordTurnActivityLine(turn, "Pulling in Slack messages…");
  recordTurnActivityLine(turn, "Searched Slack for `on-call`");

  const activity = buildChatTurnActivity(turn, 5_000);
  assert.ok(activity);
  assert.equal(
    activity.steps?.some((step) => /Processing context|Weighing gathered|Preparing answer/.test(step.content)),
    false
  );
  assert.ok(activity.steps?.some((step) => step.content.includes("Slack")));
});

test("isConcreteActivityLine rejects filler and keeps real tool lines", () => {
  assert.equal(isConcreteActivityLine("Aggregating context…"), false);
  assert.equal(isConcreteActivityLine("Writing your answer…"), false);
  assert.equal(isConcreteActivityLine("Scan complete — preparing answer…"), false);
  assert.equal(isConcreteActivityLine("Pulling in Slack messages…"), true);
  assert.equal(isConcreteActivityLine("Read `apps/api/auth.py`"), true);
  assert.equal(isConcreteActivityLine("Looked up indexed inventory"), true);
});

test("follow-up that names a file still persists a Read trail", () => {
  const turn = accumulator({
    modelMessage: "Read src/server/authMiddleware.ts and show me the export."
  });
  const activity = buildChatTurnActivity(turn, 4_000);
  assert.ok(activity);
  assert.ok(activity.tools.some((tool) => tool.label.includes("authMiddleware.ts")));
  assert.ok(activity.files.some((file) => file.path === "src/server/authMiddleware.ts"));
  assert.equal(formatWorkedForLabel(activity.durationMs), "Worked for 3s");
});

test("inventory asks persist a Looked up indexed inventory trail", () => {
  const first = buildChatTurnActivity(
    accumulator({ modelMessage: "How many files are in this repo?" }),
    3_200
  );
  assert.ok(first);
  assert.ok(first.tools.some((tool) => tool.label === "Looked up indexed inventory"));
  assert.equal(summarizeAgentExploration(first.tools)?.explored, "Explored 1 search");

  const followUp = buildChatTurnActivity(
    accumulator({ modelMessage: "how many lines of code?" }),
    2_500
  );
  assert.ok(followUp);
  assert.ok(followUp.tools.some((tool) => tool.label === "Looked up indexed inventory"));
});

test("empty turns omit activity", () => {
  assert.equal(buildChatTurnActivity(accumulator(), 1_800), undefined);
  const message = attachChatTurnActivity(
    { role: "assistant", content: "Sounds good.", timestamp: 2_000 },
    accumulator()
  );
  assert.equal(message.activity, undefined);
});

test("completed view is collapsed Worked for with thought and files", () => {
  const turn = accumulator();
  appendTurnThinkingChunk(turn, "S3 passing changes the gate.", 1_100);
  appendTurnThinkingChunk(turn, " Drop stale framing.", 2_100);
  recordTurnAgentSteps(turn, [
    { index: 0, tool: "search_code", summary: "search_code: S3", completed: true },
    { index: 1, tool: "read_file", summary: "read_file: canvases/sheet.json", completed: true }
  ]);
  const activity = buildChatTurnActivity(turn, 1_000 + 179_000);
  assert.ok(activity);
  const view = completeActivityView(activity);
  assert.equal(view.defaultCollapsed, true);
  assert.equal(view.workedLabel, "Worked for 2m 59s");
  assert.equal(view.thoughtLabel, "Thought 1s");
  assert.ok(view.filePaths.includes("canvases/sheet.json"));
  assert.equal(summarizeAgentExploration(activity.tools)?.explored, "Explored 1 file, 1 search");
  assert.equal(hasChatTurnActivity(activity), true);
});

test("formatWorkedForLabel and Thought labels match Cursor-style clocks", () => {
  assert.equal(formatWorkedForLabel(1_000), "Worked for 1s");
  assert.equal(formatWorkedForLabel(61_000), "Worked for 1m 1s");
  assert.equal(formatThoughtLabel(undefined), "Thought");
  assert.equal(formatThoughtLabel(200), "Thought");
  assert.equal(formatThoughtLabel(5_000), "Thought 5s");
});

test("looksLikeRepoPath distinguishes files from search tokens", () => {
  assert.equal(looksLikeRepoPath("src/auth.ts"), true);
  assert.equal(looksLikeRepoPath("state.py"), true);
  assert.equal(looksLikeRepoPath("StateGroup"), false);
});

test("buildModelHistory strips activity so it is not sent back to the model", () => {
  const history: ChatMessage[] = [
    { role: "user", content: "where is login?", timestamp: 1 },
    {
      role: "assistant",
      content: "In auth.ts",
      timestamp: 2,
      activity: {
        durationMs: 4000,
        thinkingText: "secret chain of thought",
        tools: [{ id: "t", kind: "read", label: "Read `src/auth.ts`", status: "done" }],
        files: [{ path: "src/auth.ts", action: "read" }]
      }
    },
    { role: "user", content: "thanks", timestamp: 3 }
  ];
  const prior = buildModelHistory(history);
  assert.equal(prior[1]?.content, "In auth.ts");
  assert.equal(prior[1]?.activity, undefined);
});
