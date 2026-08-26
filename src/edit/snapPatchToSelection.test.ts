import assert from "node:assert/strict";
import { applyHunkToContent } from "./patchContent";
import {
  coerceCommentOnlyHunk,
  extractInsertedPrefix,
  hunkExpandsSelection,
  selectionTextFromFile,
  snapHunkToSelection,
  snapPatchSetToSelection
} from "./snapPatchToSelection";

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

const FILE = [
  "class State(BaseModel):",
  "    id = models.UUIDField()",
  "    name = models.CharField()",
  "",
  "    def __str__(self):",
  "        return self.name",
  "",
  "DEFAULT_STATES = [",
  "    {",
  '        "name": "Backlog",',
  '        "color": "#94A3B8",',
  "        \"sequence\": 10000,",
  "        \"group\": StateGroup.BACKLOG.value,",
  "    },",
  "]"
].join("\n");

const WRONG_SEARCH = [
  "    {",
  '        "name": "In Progress",',
  '        "color": "#F59E0B",',
  "        \"sequence\": 35000,",
  "        \"group\": StateGroup.STARTED.value,",
  "    },"
].join("\n");

const WRONG_REPLACE = [
  "    # State representing an ongoing task",
  "    {",
  '        "name": "In Progress",',
  '        "color": "#F59E0B",',
  "        \"sequence\": 35000,",
  "        \"group\": StateGroup.STARTED.value,",
  "    },"
].join("\n");

test("extractInsertedPrefix keeps the comment above SEARCH", () => {
  const prefix = extractInsertedPrefix(WRONG_REPLACE, WRONG_SEARCH);
  assert.equal(prefix?.trim(), "# State representing an ongoing task");
});

test("selectionTextFromFile returns L38–43 style 1-based slice", () => {
  const sliced = selectionTextFromFile(FILE, [5, 6]);
  assert.equal(sliced, "    def __str__(self):\n        return self.name");
});

test("snapHunkToSelection retargets a paraphrased SEARCH onto the highlight", () => {
  const snapped = snapHunkToSelection({
    content: FILE,
    selectedLines: [5, 6],
    hunk: { search: WRONG_SEARCH, replace: WRONG_REPLACE }
  });
  assert.equal(snapped.search, "    def __str__(self):\n        return self.name");
  assert.equal(
    snapped.replace,
    "    # State representing an ongoing task\n    def __str__(self):\n        return self.name"
  );
  const applied = applyHunkToContent(FILE, snapped);
  assert.equal(applied.ok, true);
  if (applied.ok) {
    assert.ok(applied.content.includes("    # State representing an ongoing task\n    def __str__(self):"));
    assert.equal(applied.content.includes("In Progress"), false);
  }
});

test("unsnapped paraphrased SEARCH is not found in the file", () => {
  const raw = applyHunkToContent(FILE, { search: WRONG_SEARCH, replace: WRONG_REPLACE });
  assert.equal(raw.ok, false);
  if (!raw.ok) {
    assert.equal(raw.reason, "not_found");
  }
});

test("snapHunkToSelection keeps SEARCH that already matches inside the highlight", () => {
  const hunk = {
    search: "        return self.name",
    replace: "        return str(self.name)"
  };
  const snapped = snapHunkToSelection({
    content: FILE,
    selectedLines: [5, 6],
    hunk
  });
  assert.equal(snapped.search, hunk.search);
  assert.equal(snapped.replace, hunk.replace);
});

const BACKLOG_BLOCK = [
  "    {",
  '        "name": "Backlog",',
  '        "color": "#94A3B8",',
  "        \"sequence\": 10000,",
  "        \"group\": StateGroup.BACKLOG.value,",
  "    },"
].join("\n");

test("expanding comment+full-block over a short SEARCH retargets onto the highlight once", () => {
  const hunk = {
    search: '        "name": "Backlog",',
    replace: [
      "        # Represents the default state for the backlog",
      BACKLOG_BLOCK
    ].join("\n")
  };
  assert.equal(hunkExpandsSelection(hunk, BACKLOG_BLOCK), true);
  const snapped = snapHunkToSelection({
    content: FILE,
    selectedLines: [9, 14],
    hunk
  });
  assert.equal(snapped.search, BACKLOG_BLOCK);
  assert.equal(
    snapped.replace,
    `    # Represents the default state for the backlog\n${BACKLOG_BLOCK}`
  );
  const applied = applyHunkToContent(FILE, snapped);
  assert.equal(applied.ok, true);
  if (applied.ok) {
    const backlogHits = applied.content.split('"name": "Backlog"').length - 1;
    assert.equal(backlogHits, 1);
  }
});

test("REPLACE that pastes SEARCH twice becomes one JSDoc above the selection", () => {
  const signature = "export function requireAuth(";
  const selected = [
    "export function requireAuth(",
    "  auth: AuthContext | undefined,",
    "  requireInProduction: boolean",
    "): auth is AuthContext {"
  ].join("\n");
  const hunk = {
    search: signature,
    replace: [
      signature,
      "/** Returns true when auth is present or when production auth is not required. */",
      signature
    ].join("\n")
  };
  assert.equal(hunkExpandsSelection(hunk, selected), true);
  const file = `${selected}\n  if (auth) {\n    return true;\n  }\n  return !requireInProduction;\n}`;
  const snapped = snapHunkToSelection({
    content: file,
    selectedLines: [1, 4],
    hunk
  });
  assert.equal(snapped.search, selected);
  assert.equal(
    snapped.replace,
    `/** Returns true when auth is present or when production auth is not required. */\n${selected}`
  );
  const applied = applyHunkToContent(file, snapped);
  assert.equal(applied.ok, true);
  if (applied.ok) {
    const hits = applied.content.split("export function requireAuth(").length - 1;
    assert.equal(hits, 1);
  }
});

test("snapHunkToSelection retargets from selectionText when the file cannot be read", () => {
  const selected = "    def __str__(self):\n        return self.name";
  const snapped = snapHunkToSelection({
    selectionText: selected,
    selectedLines: [38, 43],
    hunk: { search: WRONG_SEARCH, replace: WRONG_REPLACE }
  });
  assert.equal(snapped.search, selected);
  assert.ok(snapped.replace.startsWith("    # State representing an ongoing task"));
  assert.ok(snapped.replace.includes("def __str__(self):"));
  assert.equal(snapped.replace.includes("In Progress"), false);
});

test("snapPatchSetToSelection retargets with selectionText when readContent is empty", () => {
  const selected = "    def __str__(self):\n        return self.name";
  const snapped = snapPatchSetToSelection(
    {
      files: [
        {
          relativePath: "apps/api/plane/db/models/state.py",
          hunks: [{ search: WRONG_SEARCH, replace: WRONG_REPLACE }]
        }
      ]
    },
    {
      selectedLines: [38, 43],
      preferredFile: "apps/api/plane/db/models/state.py",
      selectionText: selected,
      readContent: () => undefined
    }
  );
  assert.equal(snapped.files[0]?.hunks[0]?.search, selected);
});

test("snapPatchSetToSelection only retargets the highlighted file", () => {
  const snapped = snapPatchSetToSelection(
    {
      files: [
        {
          relativePath: "apps/api/plane/db/models/state.py",
          hunks: [{ search: WRONG_SEARCH, replace: WRONG_REPLACE }]
        }
      ]
    },
    {
      selectedLines: [5, 6],
      preferredFile: "apps/api/plane/db/models/state.py",
      readContent: () => FILE
    }
  );
  assert.equal(snapped.files[0]?.hunks[0]?.search.includes("__str__"), true);
});

const CONSTRUCTOR_SELECTION = [
  "  public constructor(",
  "    private readonly extensionUri: vscode.Uri,",
  "    private readonly extensionContext: vscode.ExtensionContext,",
  "    api: SecureApiClient,",
  "    services: CoopRuntimeServices",
  "  ) {"
].join("\n");

const CONSTRUCTOR_REWRITE = [
  "  public constructor(",
  "    private readonly extensionUri: vscode.Uri,",
  "    private readonly extensionContext: vscode.ExtensionContext,",
  "    private readonly api: SecureApiClient,",
  "    private readonly services: CoopRuntimeServices",
  "  ) {",
  "    this.session = new CoopChatSession({",
  "      extensionUri,"
].join("\n");

test("comment-only coerce keeps a comment and the original selection", () => {
  const coerced = coerceCommentOnlyHunk(
    {
      search: CONSTRUCTOR_SELECTION,
      replace: `  // Constructs the Coop sidebar.\n${CONSTRUCTOR_SELECTION}`
    },
    CONSTRUCTOR_SELECTION
  );
  assert.ok(coerced);
  assert.equal(coerced?.search, CONSTRUCTOR_SELECTION);
  assert.equal(
    coerced?.replace,
    `  // Constructs the Coop sidebar.\n${CONSTRUCTOR_SELECTION}`
  );
});

test("comment-only coerce drops a signature rewrite with no comment", () => {
  const coerced = coerceCommentOnlyHunk(
    { search: CONSTRUCTOR_SELECTION, replace: CONSTRUCTOR_REWRITE },
    CONSTRUCTOR_SELECTION
  );
  assert.equal(coerced, undefined);
});

test("comment-only snap rejects a constructor rewrite onto the highlight", () => {
  const snapped = snapHunkToSelection({
    selectionText: CONSTRUCTOR_SELECTION,
    selectedLines: [29, 34],
    commentOnly: true,
    hunk: {
      search: CONSTRUCTOR_SELECTION.replace("  ) {", "  )"),
      replace: CONSTRUCTOR_REWRITE
    }
  });
  assert.equal(snapped, undefined);
});

const PLANE_STATE_PY = [
  "DEFAULT_STATES = [",
  "    {",
  '        "name": "In Progress",',
  '        "color": "#F59E0B",',
  "        \"sequence\": 35000,",
  "        \"group\": StateGroup.STARTED.value,",
  "    },",
  "]",
  "",
  "class StateManager(SoftDeletionManager):",
  '    """Default manager"""',
  "",
  "    def get_queryset(self):",
  "        return super().get_queryset().exclude(group=StateGroup.TRIAGE.value)"
].join("\n");

const IN_PROGRESS_DICT = [
  "    {",
  '        "name": "In Progress",',
  '        "color": "#F59E0B",',
  "        \"sequence\": 35000,",
  "        \"group\": StateGroup.STARTED.value,",
  "    },"
].join("\n");

test("comment-only DEFAULT_STATES duplicate retargets onto get_queryset once", () => {
  const queryset = [
    "    def get_queryset(self):",
    "        return super().get_queryset().exclude(group=StateGroup.TRIAGE.value)"
  ].join("\n");
  const hunk = {
    search: IN_PROGRESS_DICT,
    replace: [
      IN_PROGRESS_DICT,
      "    # Represents the state of an item that is currently in progress.",
      IN_PROGRESS_DICT
    ].join("\n")
  };
  const snapped = snapHunkToSelection({
    content: PLANE_STATE_PY,
    selectedLines: [13, 14],
    commentOnly: true,
    hunk
  });
  assert.equal(snapped?.search, queryset);
  assert.equal(
    snapped?.replace,
    "    # Represents the state of an item that is currently in progress.\n" + queryset
  );
  const applied = applyHunkToContent(PLANE_STATE_PY, snapped!);
  assert.equal(applied.ok, true);
  if (applied.ok) {
    assert.equal(applied.content.split('"name": "In Progress"').length - 1, 1);
    assert.ok(applied.content.includes("# Represents the state of an item that is currently in progress.\n    def get_queryset"));
  }
});

const total = passed + failed;
console.log(`\nsnapPatchToSelection: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
