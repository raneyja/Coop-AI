import assert from "node:assert/strict";
import test from "node:test";
import {
  agentStepsToActivity,
  extractFileChipsFromLabels,
  toolRowsFromTodos,
  type AgentTodoItem
} from "./agentActivity";

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
