import assert from "node:assert/strict";
import { enclosingDefinitionRange } from "./enclosingDefinitionRange";

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

const total = passed + failed;
console.log(`\nenclosingDefinitionRange: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
