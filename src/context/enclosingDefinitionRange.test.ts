import assert from "node:assert/strict";
import { enclosingDefinitionAnchor, enclosingDefinitionRange, resolveEditTargetLines } from "./enclosingDefinitionRange";

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

const STATE_PY = [
  "class StateGroup(models.TextChoices):",
  '    BACKLOG = "backlog", "Backlog"',
  '    TRIAGE = "triage", "Triage"',
  "",
  "class StateManager(SoftDeletionManager):",
  '    """Default manager - excludes triage states"""',
  "",
  "    def get_queryset(self):",
  "        return super().get_queryset().exclude(group=StateGroup.TRIAGE.value)",
  "",
  "class State(ProjectBaseModel):",
  "    name = models.CharField(max_length=255)"
].join("\n");

test("click inside get_queryset selects that method, not DEFAULT_STATES / the class", () => {
  assert.deepEqual(enclosingDefinitionRange(STATE_PY, 9), [8, 9]);
});

test("click on the def line still covers the method body", () => {
  assert.deepEqual(enclosingDefinitionRange(STATE_PY, 8), [8, 9]);
});

test("click on the class header covers the whole class", () => {
  assert.deepEqual(enclosingDefinitionRange(STATE_PY, 5), [5, 9]);
});

const AUTH_TS = [
  "export function extractBearerToken(headers: Record<string, string | undefined>): string | undefined {",
  '  const header = headers.authorization ?? "";',
  "  return header || undefined;",
  "}",
  "",
  "export function requireAuth(",
  "  auth: AuthContext | undefined,",
  "  requireInProduction: boolean",
  "): auth is AuthContext {",
  "  if (auth) {",
  "    return true;",
  "  }",
  "  return !requireInProduction;",
  "}"
].join("\n");

test("click inside requireAuth selects that function, not extractBearerToken", () => {
  assert.deepEqual(enclosingDefinitionRange(AUTH_TS, 11), [6, 14]);
});

test("caret outside any function returns nothing", () => {
  assert.equal(enclosingDefinitionRange(AUTH_TS, 5), undefined);
});

const PLANE_STATE_PY = [
  "# Copyright (c) 2023-present Plane Software, Inc. and contributors",
  "# SPDX-License-Identifier: AGPL-3.0-only",
  "",
  "class StateGroup(models.TextChoices):",
  '    BACKLOG = "backlog", "Backlog"',
  '    UNSTARTED = "unstarted", "Unstarted"',
  '    STARTED = "started", "Started"',
  "",
  "DEFAULT_STATES = [",
  "    {",
  '        "name": "Todo",',
  '        "color": "#60646C",',
  "        \"sequence\": 25000,",
  "        \"group\": StateGroup.UNSTARTED.value,",
  "    },",
  "    {",
  '        "name": "In Progress",',
  '        "color": "#F59E0B",',
  "        \"sequence\": 35000,",
  "        \"group\": StateGroup.STARTED.value,",
  "    },",
  "    {",
  '        "name": "Done",',
  "    },",
  "]",
  "",
  "class StateManager(SoftDeletionManager):",
  '    """Default manager - excludes triage states"""',
  "",
  "    def get_queryset(self):",
  "        return super().get_queryset().exclude(group=StateGroup.TRIAGE.value)",
  "",
  "class State(ProjectBaseModel):",
  "    name = models.CharField(max_length=255)"
].join("\n");

const GET_QUERYSET_LINE =
  PLANE_STATE_PY.split("\n").findIndex((line) => line.includes("def get_queryset")) + 1;

test("click inside In Progress dict is not a function", () => {
  assert.equal(enclosingDefinitionRange(PLANE_STATE_PY, 18), undefined);
});

test("click inside get_queryset is not L38–43 / DEFAULT_STATES", () => {
  const range = enclosingDefinitionRange(PLANE_STATE_PY, GET_QUERYSET_LINE + 1);
  assert.ok(range);
  assert.equal(range[0], GET_QUERYSET_LINE);
  assert.ok(range[0] > 21);
  assert.equal(PLANE_STATE_PY.split("\n")[range[0] - 1]?.includes("def get_queryset"), true);
});

test("anchor names StateManager.get_queryset, not TriageStateManager", () => {
  const anchor = enclosingDefinitionAnchor(PLANE_STATE_PY, GET_QUERYSET_LINE + 1);
  assert.equal(anchor?.label, "StateManager.get_queryset");
  assert.ok(anchor && anchor.contextLine < GET_QUERYSET_LINE);
  assert.equal(
    PLANE_STATE_PY.split("\n")[anchor!.contextLine - 1]?.includes("class StateManager"),
    true
  );
});

test("Send expands caret in get_queryset over sticky DEFAULT_STATES L38–43", () => {
  const next = resolveEditTargetLines({
    fileContent: PLANE_STATE_PY,
    caretLine: GET_QUERYSET_LINE + 1,
    stickyLines: [16, 21]
  });
  assert.deepEqual(next, enclosingDefinitionRange(PLANE_STATE_PY, GET_QUERYSET_LINE + 1));
});

test("drag-select still wins over enclosing function", () => {
  const next = resolveEditTargetLines({
    dragLines: [16, 21],
    fileContent: PLANE_STATE_PY,
    caretLine: GET_QUERYSET_LINE + 1,
    stickyLines: [16, 21]
  });
  assert.deepEqual(next, [16, 21]);
});

test("precise drag inside get_queryset survives Chat focus loss", () => {
  const enclosing = enclosingDefinitionRange(PLANE_STATE_PY, GET_QUERYSET_LINE + 1);
  assert.ok(enclosing);
  const sticky: [number, number] = [enclosing[0], enclosing[0]];
  const next = resolveEditTargetLines({
    fileContent: PLANE_STATE_PY,
    caretLine: GET_QUERYSET_LINE,
    stickyLines: sticky
  });
  assert.deepEqual(next, sticky);
});

test("click in DEFAULT_STATES clears leftover highlight", () => {
  const next = resolveEditTargetLines({
    fileContent: PLANE_STATE_PY,
    caretLine: 18,
    stickyLines: [16, 21],
    userClearedSelection: true
  });
  assert.equal(next, undefined);
});

test("Chat click with no caret keeps sticky range", () => {
  const next = resolveEditTargetLines({
    stickyLines: [16, 21]
  });
  assert.deepEqual(next, [16, 21]);
});

const total = passed + failed;
console.log(`\nenclosingDefinitionRange: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
