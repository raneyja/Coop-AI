import assert from "node:assert/strict";
import test from "node:test";
import {
  agentStepsToActivity,
  buildActivityTodosFromFeedback,
  classifyActivityTodoKind,
  extractFileChipsFromLabels,
  nextLiveThinkingOpenState,
  partitionActivityTodos,
  summarizeAgentExploration,
  toolRowsFromTodos,
  type AgentTodoItem
} from "./agentActivity";
import { ACTIVITY_PHASE_MS, ACTIVITY_START_DELAY_MS } from "./thinkingMessageRotation";

test("classifyActivityTodoKind splits plan from finished research", () => {
  assert.equal(classifyActivityTodoKind("Find DateTimeUtils in the repo"), "plan");
  assert.equal(classifyActivityTodoKind("Search Jira for SQL-injection"), "plan");
  assert.equal(classifyActivityTodoKind("Searching Slack for SQL-injection…"), "plan");
  assert.equal(classifyActivityTodoKind("Searched Jira for `SQL-injection`"), "research");
  assert.equal(classifyActivityTodoKind("Read `DateTimeUtils.java`"), "research");
  assert.equal(classifyActivityTodoKind("Searching repo for `reports.jsp`"), "research");
});

test("partitionActivityTodos keeps the plan and drops Searching once Searched exists", () => {
  const split = partitionActivityTodos([
    { id: "1", content: "Find DateTimeUtils, reports.jsp in the repo", status: "completed" },
    { id: "2", content: "Search Jira for SQL-injection", status: "completed" },
    { id: "3", content: "Searching Slack for SQL-injection…", status: "in_progress" },
    { id: "4", content: "Searched Jira for `SQL-injection`", status: "completed" },
    { id: "5", content: "Read `DateTimeUtils.java`", status: "completed" }
  ]);
  assert.deepEqual(
    split.plan.map((todo) => todo.content),
    [
      "Find DateTimeUtils, reports.jsp in the repo",
      "Search Jira for SQL-injection",
      "Searching Slack for SQL-injection…"
    ]
  );
  assert.equal(split.research.length, 2);
});

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

test("gather theater does not become file chips or an explored count", () => {
  const chips = extractFileChipsFromLabels([
    "Gathering workspace context…",
    "Searching indexed codebase…",
    "Updating lightweight context…"
  ]);
  assert.deepEqual(chips, []);
  assert.equal(classifyActivityTodoKind("Read `src/a.ts`"), "research");
  assert.equal(classifyActivityTodoKind("Searched for `requireAuth`"), "research");
  assert.equal(classifyActivityTodoKind("Gathering workspace context…"), "plan");
  const tools = toolRowsFromTodos([
    { id: "1", content: "Gathering workspace context…", status: "completed" },
    { id: "2", content: "Read `src/a.ts`", status: "completed" }
  ]);
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.label, "Read `src/a.ts`");
  assert.equal(summarizeAgentExploration(tools)?.explored, "Explored 1 file");
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

test("live thinking auto-opens until the user collapses it", () => {
  assert.equal(
    nextLiveThinkingOpenState({
      isComplete: false,
      userTouched: false,
      streaming: true,
      hasText: true
    }),
    true
  );
  assert.equal(
    nextLiveThinkingOpenState({
      isComplete: false,
      userTouched: false,
      streaming: true,
      hasText: false
    }),
    false
  );
  assert.equal(
    nextLiveThinkingOpenState({
      isComplete: false,
      userTouched: true,
      streaming: true,
      hasText: true
    }),
    null
  );
  assert.equal(
    nextLiveThinkingOpenState({
      isComplete: true,
      userTouched: false,
      streaming: false,
      hasText: true
    }),
    null
  );
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
  assert.ok(todos.some((todo) => todo.content === "Searching GitHub estate index…"));
  assert.ok(!todos.some((todo) => /distilling|aggregating|weighing gathered/i.test(todo.content)));
  const last = todos[todos.length - 1];
  assert.equal(last?.status, "in_progress");
  assert.ok(todos.slice(0, -1).every((todo) => todo.status === "completed"));
});

test("awaitingResponse shows gather todos immediately (no blank start delay)", () => {
  const todos = buildActivityTodosFromFeedback(
    {
      status: "loading",
      title: "Fetching context",
      activityMessages: ["Read `src/server/authMiddleware.ts`"]
    },
    undefined,
    { awaitingResponse: true },
    0
  );
  assert.equal(todos.length, 1);
  assert.equal(todos[0]?.status, "in_progress");
});
