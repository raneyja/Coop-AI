import assert from "node:assert/strict";
import test from "node:test";
import {
  agentStepsToActivity,
  buildActivityTodosFromFeedback,
  extractFileChipsFromLabels,
  summarizeAgentExploration,
  toolRowsFromTodos,
  type AgentTodoItem
} from "./agentActivity";
import { ACTIVITY_PHASE_MS, ACTIVITY_START_DELAY_MS } from "./thinkingMessageRotation";

test("agentStepsToActivity humanizes search/read tools", () => {
  const activity = agentStepsToActivity([
    { index: 0, tool: "search_code", summary: "search_code: StateGroup", completed: true },
    { index: 1, tool: "read_file", summary: "read_file: state.py", completed: false }
  ]);
  assert.equal(activity.todos[0]?.content, "Searched for `StateGroup`");
  assert.equal(activity.todos[1]?.status, "in_progress");
  assert.equal(activity.files.some((file) => file.path === "state.py"), true);
});

test("toolRowsFromTodos skips pending", () => {
  const todos: AgentTodoItem[] = [
    { id: "1", content: "Analyzing dependencies…", status: "completed" },
    { id: "2", content: "Reading `state.py`", status: "in_progress" },
    { id: "3", content: "Later", status: "pending" }
  ];
  const tools = toolRowsFromTodos(todos);
  assert.equal(tools.length, 2);
  assert.equal(tools[1]?.kind, "read");
});

test("extractFileChipsFromLabels picks backtick paths", () => {
  const chips = extractFileChipsFromLabels(["Searched for `**/CODEOWNERS`", "Read foo/bar.ts"]);
  assert.ok(chips.some((chip) => chip.path === "**/CODEOWNERS"));
  assert.ok(chips.some((chip) => chip.path === "foo/bar.ts"));
});

test("agentStepsToActivity keeps every tool row (no leftover-steps count)", () => {
  const activity = agentStepsToActivity(
    Array.from({ length: 8 }, (_, index) => ({
      index,
      tool: "search_code",
      summary: `search_code: q${index}`,
      completed: true
    }))
  );
  assert.equal(activity.tools.length, 8);
  assert.equal(activity.todos.length, 8);
  assert.equal(
    activity.todos.some((todo) => /more step/.test(todo.content)),
    false
  );
});

test("summarizeAgentExploration uses Explored / Exploring, not remaining steps", () => {
  const activity = agentStepsToActivity([
    { index: 0, tool: "search_code", summary: "search_code: a", completed: true },
    { index: 1, tool: "search_code", summary: "search_code: b", completed: true },
    { index: 2, tool: "read_file", summary: "read_file: auth.ts", completed: true },
    { index: 3, tool: "read_file", summary: "read_file: session.ts", completed: false }
  ]);
  const summary = summarizeAgentExploration(activity.tools);
  assert.equal(summary?.explored, "Explored 1 file, 2 searches");
  assert.equal(summary?.exploring, "Exploring 1 file");
  assert.equal(summary?.explored?.includes("more"), false);
});

test("summarizeAgentExploration is null without real tools", () => {
  assert.equal(summarizeAgentExploration([]), null);
});

test("synthesis wait does not invent Distilling/Aggregating todos", () => {
  const todos = buildActivityTodosFromFeedback(
    undefined,
    undefined,
    { awaitingResponse: true },
    ACTIVITY_START_DELAY_MS + ACTIVITY_PHASE_MS * 4,
    12,
    20_000
  );
  assert.deepEqual(todos, []);
});

test("real gather lines stay visible after synthesis starts", () => {
  const todos = buildActivityTodosFromFeedback(
    {
      status: "loading",
      title: "Fetching context",
      activityMessages: ["Searching GitHub estate index…", "Pulling in Slack messages…"]
    },
    undefined,
    { awaitingResponse: true },
    ACTIVITY_START_DELAY_MS + ACTIVITY_PHASE_MS * 4,
    0,
    5_000
  );
  assert.ok(todos.every((todo) => todo.status === "completed"));
  assert.ok(todos.some((todo) => todo.content === "Searching GitHub estate index…"));
  assert.ok(!todos.some((todo) => /distilling|aggregating|weighing gathered/i.test(todo.content)));
});
