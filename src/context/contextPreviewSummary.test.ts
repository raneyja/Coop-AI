import assert from "node:assert/strict";
import { buildContextPreviewChips } from "./contextPreviewSummary";

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

test("buildContextPreviewChips includes active file and repo", () => {
  const chips = buildContextPreviewChips({
    context: {
      owner: "acme",
      repo: "widgets",
      branch: "main",
      file: "src/auth.ts",
      scope: "file"
    }
  });
  assert.ok(chips.some((c) => c.kind === "file" && c.label.includes("auth")));
  assert.ok(chips.some((c) => c.kind === "repo"));
});

test("buildContextPreviewChips adds estimated Jira chip when query mentions jira", () => {
  const chips = buildContextPreviewChips({
    context: { owner: "acme", repo: "widgets", file: "a.ts", scope: "file" },
    draftMessage: "what jira tickets link to this repo?"
  });
  assert.ok(chips.some((c) => c.kind === "integration" && c.label === "Jira" && c.state === "estimated"));
});

test("buildContextPreviewChips includes selection range", () => {
  const chips = buildContextPreviewChips({
    context: { file: "a.ts", selectedLines: [10, 20], scope: "file" }
  });
  assert.ok(chips.some((c) => c.kind === "selection" && c.label === "L10–20"));
});

test("buildContextPreviewChips labels remote-first file with owner/repo", () => {
  const chips = buildContextPreviewChips({
    context: {
      owner: "acme",
      repo: "widgets",
      file: "src/auth.ts",
      fileSource: "remote",
      scope: "file"
    }
  });
  const fileChip = chips.find((c) => c.kind === "file");
  assert.equal(fileChip?.detail, "acme/widgets");
});

test("buildContextPreviewChips labels VFS-only remote without owner as remote tab", () => {
  const chips = buildContextPreviewChips({
    context: {
      file: "src/auth.ts",
      fileSource: "remote",
      scope: "file"
    }
  });
  const fileChip = chips.find((c) => c.kind === "file");
  assert.equal(fileChip?.detail, "remote tab");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
