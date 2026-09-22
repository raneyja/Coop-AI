import assert from "node:assert/strict";
import {
  shouldHidePatchMarkdownForMessage,
  shouldRenderPatchCardForMessage,
  isCreatePullRequestEnabled,
  showCreatePullRequestButton
} from "./PatchCard";
import type { PatchCardState } from "../chat/types";
import { formatPatchLandingCopy } from "./patchLocationLabel";

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

const baseFiles: PatchCardState["files"] = [
  {
    relativePath: "src/example.ts",
    hunks: [
      {
        id: "h1",
        matchStatus: "matched",
        lines: [
          { kind: "remove", text: "old" },
          { kind: "add", text: "new" }
        ]
      }
    ]
  }
];

test("pending card renders and hides markdown for matching message", () => {
  const cards: PatchCardState[] = [
    {
      status: "pending",
      messageTimestamp: 10,
      fileCount: 1,
      hunkCount: 1,
      files: baseFiles,
      suppressMarkdown: true
    }
  ];
  assert.equal(shouldRenderPatchCardForMessage(cards, 10), true);
  assert.equal(shouldHidePatchMarkdownForMessage(cards, 10), true);
  assert.equal(shouldRenderPatchCardForMessage(cards, 99), false);
});

test("rejected card stays in thread and keeps markdown hidden", () => {
  const cards: PatchCardState[] = [
    {
      status: "rejected",
      messageTimestamp: 10,
      fileCount: 1,
      hunkCount: 1,
      files: baseFiles,
      canUndo: true,
      suppressMarkdown: true
    }
  ];
  assert.equal(shouldRenderPatchCardForMessage(cards, 10), true);
  assert.equal(shouldHidePatchMarkdownForMessage(cards, 10), true);
});

test("a newer /edit patch keeps older card visible and markdown suppressed", () => {
  const cards: PatchCardState[] = [
    {
      status: "rejected",
      messageTimestamp: 10,
      fileCount: 1,
      hunkCount: 1,
      files: baseFiles,
      canUndo: true,
      suppressMarkdown: true
    },
    {
      status: "pending",
      messageTimestamp: 20,
      fileCount: 1,
      hunkCount: 1,
      files: baseFiles,
      suppressMarkdown: true,
      suppressedMessageTimestamps: [10, 20]
    }
  ];
  assert.equal(shouldHidePatchMarkdownForMessage(cards, 10, [10, 20]), true);
  assert.equal(shouldRenderPatchCardForMessage(cards, 10), true);
  assert.equal(shouldHidePatchMarkdownForMessage(cards, 20, [10, 20]), true);
  assert.equal(shouldRenderPatchCardForMessage(cards, 20), true);
});

test("failed empty card still renders so /edit never falls back to an anonymous fence", () => {
  const cards: PatchCardState[] = [
    {
      status: "failed",
      messageTimestamp: 10,
      fileCount: 0,
      hunkCount: 0,
      files: [],
      error: "Patch blocks found but no File: header",
      suppressMarkdown: true
    }
  ];
  assert.equal(shouldRenderPatchCardForMessage(cards, 10), true);
  assert.equal(shouldHidePatchMarkdownForMessage(cards, 10, [10]), true);
  assert.equal(showCreatePullRequestButton(cards[0]!), false);
});

test("B-G7 / UX-G4 Create PR is hidden until Apply sets canCreatePr", () => {
  const pending: PatchCardState = {
    status: "pending",
    messageTimestamp: 10,
    fileCount: 1,
    hunkCount: 1,
    files: baseFiles,
    canCreatePr: false
  };
  assert.equal(showCreatePullRequestButton(pending), false);
  assert.equal(
    showCreatePullRequestButton({ ...pending, status: "applied", canCreatePr: true }),
    true
  );
  const appliedWithFiles = {
    ...pending,
    status: "applied" as const,
    canCreatePr: false,
    prFiles: [{ path: "src/example.ts", content: "new\n" }]
  };
  assert.equal(showCreatePullRequestButton(appliedWithFiles), true);
  assert.equal(isCreatePullRequestEnabled(appliedWithFiles), true);
});

test("local-file Apply keeps Create PR visible and disabled", () => {
  const pending: PatchCardState = {
    status: "pending",
    messageTimestamp: 10,
    fileCount: 1,
    hunkCount: 1,
    files: baseFiles,
    prBlockedReason: "local-file"
  };
  assert.equal(showCreatePullRequestButton(pending), false);
  assert.equal(isCreatePullRequestEnabled(pending), false);
  const applied: PatchCardState = {
    ...pending,
    status: "applied",
    canCreatePr: false,
    prBlockedReason: "local-file",
    prFiles: [{ path: "/Users/jon/Desktop/cody-vs-main/src/Foo.cs", content: "// yo\n" }]
  };
  assert.equal(showCreatePullRequestButton(applied), true);
  assert.equal(isCreatePullRequestEnabled(applied), false);
  const samePathClone: PatchCardState = {
    ...pending,
    status: "applied",
    canCreatePr: true,
    prBlockedReason: undefined,
    prFiles: [{ path: "src/Cody.Core/Agent/Foo.cs", content: "// remote\n" }]
  };
  assert.equal(showCreatePullRequestButton(samePathClone), true);
  assert.equal(isCreatePullRequestEnabled(samePathClone), true);
});

test("landing copy names the class.method and file", () => {
  const files: PatchCardState["files"] = [
    {
      relativePath: "apps/api/plane/db/models/state.py",
      hunks: [
        {
          id: "h1",
          matchStatus: "matched",
          lines: [],
          anchorLabel: "StateManager.get_queryset",
          startLine: 69,
          endLine: 70
        }
      ]
    }
  ];
  assert.equal(
    formatPatchLandingCopy(files, "applied"),
    "Landed in StateManager.get_queryset · L69–70 · state.py."
  );
  assert.equal(
    formatPatchLandingCopy(files, "pending"),
    "Lands in StateManager.get_queryset · L69–70 · state.py."
  );
});

console.log(`\nPatchCard helpers: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
